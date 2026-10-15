-- PARCHE 128 — Reclasificación de REPROCESO (color, talla, tipo de falla, cantidad)
-- Magdalena (y cualquier operario de REPROCESO) anota, por lote, cómo clasificó las
-- prendas después de la operación: color, talla, tipo de falla y cantidad. Se cuelga de
-- la PENÚLTIMA operación del artículo (_ultimas, parche 125): el total reclasificado
-- no puede pasar de lo reportado en esa operación.
-- No genera minutos: es el desglose de lo que ya se reportó.
-- Rollback: parche_128_rollback.sql
begin;

create table if not exists public.reproceso_reclasif (
  id          bigserial primary key,
  o_f         text not null,
  articulo    text not null,
  n_op        integer not null,
  color       text not null,
  talla       text not null,
  falla       text not null,
  cantidad    integer not null check (cantidad > 0 and cantidad <= 1000000),
  dni         text not null,
  creado      timestamptz not null default now(),
  estado      text not null default 'ACTIVO' check (estado in ('ACTIVO','ANULADO')),
  anulado_por text,
  anulado     timestamptz
);
create index if not exists reproceso_reclasif_of on public.reproceso_reclasif (o_f, estado);
alter table public.reproceso_reclasif enable row level security;
revoke all on public.reproceso_reclasif from anon, authenticated;

-- Quién puede anotar: operarios de REPROCESO, o Ingeniería/supervisión con Edición en el área.
create or replace function public._reclasif_permiso(o operarios)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select (o.cargo in ('OPERARIO','ESTAJERO') and o.area_actual = 'REPROCESO') or _lote_permiso(o, 'REPROCESO', true)
$$;
revoke all on function public._reclasif_permiso(operarios) from public, anon, authenticated;

-- Penúltima operación del lote, lo reportado en ella y lo ya reclasificado.
create or replace function public.fn_reproceso_reclasif_info(p_dni text, p_token uuid, p_of text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; f ofs; v_n2 int; v_op text; v_hecho numeric; v_rec numeric;
begin
  o := _auth(p_dni, p_token);
  if not _reclasif_permiso(o) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a la reclasificación de REPROCESO'; end if;
  select * into f from ofs where _nk(o_f) = _nk(p_of) and reproceso;
  if not found then return json_build_object('ok', false, 'error', 'Ese lote no es de REPROCESO'); end if;
  select u.n2 into v_n2 from _ultimas('REPROCESO') u where u.k = _nk(f.articulo);
  if v_n2 is null then
    return json_build_object('ok', false, 'error', 'La base de ' || f.articulo || ' no tiene penúltima operación'); end if;
  select b.operacion into v_op from bases b
   where b.area = 'REPROCESO' and _nk(b.articulo) = _nk(f.articulo) and b.n_op = v_n2 order by b.id limit 1;
  select coalesce(sum(cant), 0) into v_hecho from reclamos
   where area = 'REPROCESO' and estado = 'ACTIVO' and _nk(o_f) = _nk(f.o_f) and nop = v_n2;
  select coalesce(sum(cantidad), 0) into v_rec from reproceso_reclasif where o_f = f.o_f and estado = 'ACTIVO';
  return json_build_object('ok', true, 'of', f.o_f, 'articulo', f.articulo,
    'n_op', v_n2, 'operacion', v_op, 'hecho', v_hecho, 'reclasificado', v_rec,
    'queda', greatest(v_hecho - v_rec, 0),
    'filas', coalesce((select json_agg(json_build_object('id', r.id, 'color', r.color, 'talla', r.talla, 'falla', r.falla,
              'cantidad', r.cantidad, 'por', coalesce(p.nombres_apellidos, r.dni), 'dni', r.dni, 'creado', r.creado) order by r.id desc)
            from (select * from reproceso_reclasif where o_f = f.o_f and estado = 'ACTIVO' order by id desc limit 60) r
            left join operarios p on p.dni = r.dni), '[]'::json),
    'fallas', coalesce((select json_agg(x) from (select falla x from reproceso_reclasif where estado = 'ACTIVO'
              group by falla order by count(*) desc, falla limit 30) t), '[]'::json),
    'colores', coalesce((select json_agg(x) from (select color x from reproceso_reclasif where o_f = f.o_f and estado = 'ACTIVO'
              group by color order by count(*) desc, color limit 15) t), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_reclasif_info(text, uuid, text) to anon, authenticated;

create or replace function public.fn_reproceso_reclasificar(p_dni text, p_token uuid, p_of text, p_color text, p_talla text, p_falla text, p_cant integer)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; f ofs; v_n2 int; v_hecho numeric; v_rec numeric;
        v_color text := upper(trim(coalesce(p_color, '')));
        v_talla text := upper(trim(coalesce(p_talla, '')));
        v_falla text := upper(trim(coalesce(p_falla, '')));
begin
  o := _auth(p_dni, p_token);
  if not _reclasif_permiso(o) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a la reclasificación de REPROCESO'; end if;
  if v_color = '' or v_talla = '' or v_falla = '' then
    return json_build_object('ok', false, 'error', 'Completa color, talla y tipo de falla'); end if;
  if length(v_color) > 40 or length(v_talla) > 20 or length(v_falla) > 60 then
    return json_build_object('ok', false, 'error', 'Texto demasiado largo'); end if;
  if coalesce(p_cant, 0) <= 0 or p_cant > 1000000 then return json_build_object('ok', false, 'error', 'Pon la cantidad'); end if;
  select * into f from ofs where _nk(o_f) = _nk(p_of) and reproceso;
  if not found then return json_build_object('ok', false, 'error', 'Ese lote no es de REPROCESO'); end if;
  select u.n2 into v_n2 from _ultimas('REPROCESO') u where u.k = _nk(f.articulo);
  if v_n2 is null then
    return json_build_object('ok', false, 'error', 'La base de ' || f.articulo || ' no tiene penúltima operación'); end if;
  perform pg_advisory_xact_lock(hashtext('reproceso_reclasif:' || f.o_f));
  select coalesce(sum(cant), 0) into v_hecho from reclamos
   where area = 'REPROCESO' and estado = 'ACTIVO' and _nk(o_f) = _nk(f.o_f) and nop = v_n2;
  select coalesce(sum(cantidad), 0) into v_rec from reproceso_reclasif where o_f = f.o_f and estado = 'ACTIVO';
  if v_rec + p_cant > v_hecho then
    return json_build_object('ok', false, 'error', 'Solo hay ' || round(v_hecho - v_rec, 0) ||
      ' prendas por reclasificar: en la penúltima operación se han reportado ' || round(v_hecho, 0)); end if;
  insert into reproceso_reclasif (o_f, articulo, n_op, color, talla, falla, cantidad, dni)
  values (f.o_f, f.articulo, v_n2, v_color, v_talla, v_falla, p_cant, o.dni);
  return json_build_object('ok', true, 'queda', v_hecho - v_rec - p_cant);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_reclasificar(text, uuid, text, text, text, text, integer) to anon, authenticated;

-- Anular una fila (error de dedo): quien la anotó, o Ingeniería con Edición.
create or replace function public.fn_reproceso_reclasif_anular(p_dni text, p_token uuid, p_id bigint)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; r reproceso_reclasif;
begin
  o := _auth(p_dni, p_token);
  if not _reclasif_permiso(o) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a la reclasificación de REPROCESO'; end if;
  select * into r from reproceso_reclasif where id = p_id and estado = 'ACTIVO';
  if not found then return json_build_object('ok', false, 'error', 'Esa fila ya no existe'); end if;
  if r.dni <> o.dni and not _lote_permiso(o, 'REPROCESO', true) then
    raise exception 'NO_AUTORIZADA: solo quien la anotó puede anularla'; end if;
  update reproceso_reclasif set estado = 'ANULADO', anulado_por = o.dni, anulado = now() where id = p_id;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_reclasif_anular(text, uuid, bigint) to anon, authenticated;

commit;
