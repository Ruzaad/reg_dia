-- PARCHE 141 — Editar lotes de REPROCESO (nombre y cantidad)
-- Si la cantidad baja de lo ya notificado en una operación, el exceso se resta de lo
-- registrado repartido en proporción a lo que cada registro (persona y día) aportó,
-- para no pegarle a un solo día. Cada cambio queda en reproceso_lote_ajuste.
-- No toca fn_reproceso_lote_crear (los fronts viejos siguen igual). Rollback: parche_141_rollback.sql
begin;

create table if not exists public.reproceso_lote_cambios (
  id bigserial primary key,
  of_antes text not null, of_despues text not null,
  cant_antes numeric, cant_despues numeric,
  descuento numeric not null default 0,
  por text, creado timestamptz not null default now()
);
create table if not exists public.reproceso_lote_ajuste (
  id bigserial primary key,
  cambio_id bigint not null references public.reproceso_lote_cambios(id) on delete cascade,
  reclamo_id bigint not null, o_f text, nop int, dni text, fecha date,
  cant_antes numeric not null, cant_despues numeric not null
);
alter table public.reproceso_lote_cambios enable row level security;
alter table public.reproceso_lote_ajuste enable row level security;

create or replace function public.fn_reproceso_lote_editar(p_dni text, p_token uuid, p_of text,
    p_nombre text, p_cantidad integer, p_simular boolean default false)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; f ofs; v_nom text := upper(trim(coalesce(p_nombre,''))); v_cid bigint; v_total numeric; v_det json;
begin
  o := _auth(p_dni, p_token);
  if not _lote_permiso(o, 'REPROCESO', true) then raise exception 'NO_AUTORIZADA_AREA: no puedes editar lotes de REPROCESO'; end if;
  if v_nom = '' or length(v_nom) > 20 then return json_build_object('ok', false, 'error', 'Escribe el nombre del lote (máximo 20 letras)'); end if;
  if coalesce(p_cantidad, 0) <= 0 or p_cantidad > 1000000 then return json_build_object('ok', false, 'error', 'Pon la cantidad de prendas del lote'); end if;
  perform pg_advisory_xact_lock(hashtext('reproceso_lote:' || _nk(p_of)));
  select * into f from ofs where reproceso and _nk(o_f) = _nk(p_of);
  if not found then return json_build_object('ok', false, 'error', 'Ese lote no es de REPROCESO'); end if;
  if _nk(v_nom) <> _nk(f.o_f) then
    perform pg_advisory_xact_lock(hashtext('reproceso_lote:' || _nk(v_nom)));
    if exists (select 1 from ofs where _nk(o_f) = _nk(v_nom)) then
      return json_build_object('ok', false, 'error', 'Ya existe una OF o lote llamado ' || v_nom); end if;
  end if;

  -- Por cada operación que pasa del nuevo tope: el exceso se reparte entre sus registros
  -- en proporción a la cantidad de cada uno (el resto, por mayor fracción).
  create temp table _red141 on commit drop as
  with fi as (
    select r.id, r.dni, r.fecha, r.nop, r.cant, sum(r.cant) over (partition by r.nop) tot
      from reclamos r
     where r.area = 'REPROCESO' and r.estado = 'ACTIVO' and r.cant > 0 and _nk(r.o_f) = _nk(f.o_f)),
  ba as (
    select fi.*, fi.tot - p_cantidad ex, floor(fi.cant * (fi.tot - p_cantidad) / fi.tot) b,
           fi.cant * (fi.tot - p_cantidad) / fi.tot - floor(fi.cant * (fi.tot - p_cantidad) / fi.tot) fr
      from fi where fi.tot > p_cantidad),
  re as (
    select ba.*, round(ba.ex - sum(ba.b) over (partition by ba.nop)) sobra,
           row_number() over (partition by ba.nop order by ba.fr desc, ba.id) k from ba)
  select id, dni, fecha, nop, cant, b + case when k <= sobra then 1 else 0 end quita from re;

  select coalesce(sum(quita), 0) into v_total from _red141;
  select coalesce(json_agg(x order by x->>'nombre'), '[]'::json) into v_det from (
    select json_build_object('dni', t.dni, 'nombre', coalesce(op.nombres_apellidos, t.dni),
        'quita', sum(t.quita),
        'dias', (select json_agg(json_build_object('fecha', d.fecha, 'antes', d.antes, 'quita', d.quita) order by d.fecha)
                   from (select fecha, sum(cant) antes, sum(quita) quita from _red141 z where z.dni = t.dni and z.quita > 0 group by fecha) d)) x
      from _red141 t left join operarios op on op.dni = t.dni
     where t.quita > 0 group by t.dni, op.nombres_apellidos) q;

  if p_simular then
    return json_build_object('ok', true, 'simulado', true, 'nombre', v_nom, 'cant_antes', f.cant_prog, 'cant', p_cantidad,
                             'descuento_total', v_total, 'personas', v_det);
  end if;

  insert into reproceso_lote_cambios (of_antes, of_despues, cant_antes, cant_despues, descuento, por)
  values (f.o_f, v_nom, f.cant_prog, p_cantidad, v_total, o.dni) returning id into v_cid;
  if v_total > 0 then
    insert into reproceso_lote_ajuste (cambio_id, reclamo_id, o_f, nop, dni, fecha, cant_antes, cant_despues)
    select v_cid, id, f.o_f, nop, dni, fecha, cant, cant - quita from _red141 where quita > 0;
    update reclamos r set cant = r.cant - z.quita from _red141 z where r.id = z.id and z.quita > 0;
  end if;
  update ofs set cant_prog = p_cantidad where o_f = f.o_f;
  if v_nom <> f.o_f then
    update reclamos set o_f = v_nom where area = 'REPROCESO' and _nk(o_f) = _nk(f.o_f);
    update reproceso_reclasif set o_f = v_nom where _nk(o_f) = _nk(f.o_f);
    update ofs set o_f = v_nom where o_f = f.o_f;
  end if;
  return json_build_object('ok', true, 'of', v_nom, 'cant', p_cantidad, 'descuento_total', v_total, 'personas', v_det);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_lote_editar(text, uuid, text, text, integer, boolean) to anon, authenticated;

commit;
