-- PARCHE 126 — REPROCESO se trabaja como ACABADO (bases en la misma ruta, lote = OF provisional)
-- Hasta hoy REPROCESO trabajaba por tiempo (lotes con EMPEZAR/TERMINAR) y desde
-- el parche 123 tenía un editor de bases aparte. Ahora funciona igual que
-- ACABADO: su BASE se sube en Bases como la de cualquier área (prenda, cliente,
-- artículo, operación, STD, operación máxima y N° de operación); el lote (p. ej.
-- 9CY740) es una OF provisional con su cantidad tope; el operario entra, busca
-- el lote, ve sus operaciones y registra cantidades. Cada registro lleva el STD
-- de la BASE, así que cuenta para eficiencia y bonificaciones.
--
-- Lo que ya había generado Ingeniería se conserva: la base de lote_bases pasa a
-- `bases` (área REPROCESO) y sus lotes abiertos pasan a OF provisional con la
-- misma cantidad. Los lotes por tiempo de REPROCESO quedan cerrados (nadie
-- había registrado prendas). DESPACHO y CORTE siguen por tiempo.
-- Las tablas lote_bases y lote_base_ops NO se borran (conservan lo subido);
-- se pueden borrar después con confirmación.
-- Rollback: parche_126_rollback.sql
begin;

-- Marca de las OF provisionales de REPROCESO (las reales nunca se tocan).
alter table public.ofs add column if not exists reproceso boolean not null default false;

-- ---------- Lo ya generado pasa a BASES y a OF provisional ----------
insert into public.bases (area, prenda, cliente, modulo, articulo, operacion, std, max_op, n_op, subido_por)
select 'REPROCESO',
       case when exists (select 1 from lote_base_ops z where z.base_id = b.id and z.operacion ilike '%CAMISA%') then 'CAMISA' else '' end,
       null, 'REPROCESO', upper(trim(b.nombre)), k.operacion, k.std,
       (select max(z.n_op) from lote_base_ops z where z.base_id = b.id and z.activo), k.n_op,
       coalesce(b.actualizado_por, b.creado_por)
  from lote_bases b join lote_base_ops k on k.base_id = b.id and k.activo
 where b.area = 'REPROCESO' and b.activo
   and not exists (select 1 from bases x where x.area = 'REPROCESO' and _nk(x.articulo) = _nk(b.nombre))
 order by b.id, k.n_op;

insert into public.ofs (o_f, articulo, prenda, cant_prog, cargado_por, reproceso)
select g.destino, g.art, coalesce((select x.prenda from bases x where x.area = 'REPROCESO' and _nk(x.articulo) = _nk(g.art) limit 1), ''),
       g.cant, g.por, true
  from (select upper(trim(l.destino)) destino, upper(trim(b.nombre)) art, max(l.cantidad) cant, min(l.creado_por) por
          from lotes l join lote_base_ops k on k.id = l.base_op_id join lote_bases b on b.id = k.base_id
         where l.area = 'REPROCESO' and l.estado = 'ABIERTO' and b.area = 'REPROCESO'
         group by 1, 2) g
 where exists (select 1 from bases x where x.area = 'REPROCESO' and _nk(x.articulo) = _nk(g.art))
on conflict (o_f) do nothing;

-- Los lotes por tiempo de REPROCESO se cierran; un tramo en curso o por revisar queda en 0 prendas.
update public.lote_tramos t set fin = coalesce(t.fin, now()), prendas = coalesce(t.prendas, 0),
       auto = case when t.fin is null then true else t.auto end, revisado = coalesce(t.revisado, now()), revisado_por = coalesce(t.revisado_por, 'SISTEMA')
  from public.lotes l
 where l.id = t.lote_id and l.area = 'REPROCESO' and (t.fin is null or t.prendas is null);
update public.lotes set estado = 'CERRADO', cerrado = now(), cerrado_por = 'SISTEMA'
 where area = 'REPROCESO' and estado = 'ABIERTO';

-- ---------- Nadie entra a REPROCESO por lotes ----------
create or replace function public._lote_area_hoy(o operarios)
 returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select e.area from lote_area_elegida e where e.dni = o.dni and e.fecha = _hoy() and e.area in ('DESPACHO','CORTE')),
    (select case a.estado when 'EN DESPACHO' then 'DESPACHO' when 'EN CORTE' then 'CORTE' end
       from asistencia a where a.dni = o.dni and a.fecha = _hoy()
      order by a.creado desc limit 1),
    case when o.area_actual = 'CORTE' then 'CORTE' end)
$$;
revoke all on function public._lote_area_hoy(operarios) from public, anon, authenticated;

create or replace function public.fn_lote_elegir_area(p_dni text, p_token uuid, p_area text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_area text := upper(trim(coalesce(p_area,'')));
begin
  o := _auth(p_dni, p_token);
  if o.cargo not in ('OPERARIO','ESTAJERO') then return json_build_object('ok', true, 'area', null); end if;
  if v_area not in ('DESPACHO','CORTE') then
    delete from lote_area_elegida where dni = o.dni and fecha = _hoy();
    return json_build_object('ok', true, 'area', null);
  end if;
  insert into lote_area_elegida (dni, fecha, area) values (o.dni, _hoy(), v_area)
  on conflict (dni, fecha) do update set area = excluded.area, creado = now();
  return json_build_object('ok', true, 'area', v_area);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- Se quita el editor de bases por lotes del parche 123 ----------
drop function if exists public.fn_lote_crear_base(text, uuid, integer, text, integer, text);
drop function if exists public.fn_lote_base_guardar(text, uuid, integer, text, text, json, boolean, date);
drop function if exists public.fn_lote_bases(text, uuid);

-- ---------- Lotes de REPROCESO = OF provisional ----------
-- Bases de REPROCESO (las que se suben en Bases) y los lotes ya creados con su avance.
create or replace function public.fn_reproceso_bases(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  if not _lote_permiso(o, 'REPROCESO', true) then return json_build_object('ok', true, 'puede', false); end if;
  return json_build_object('ok', true, 'puede', true,
    'bases', coalesce((select json_agg(json_build_object('articulo', a.articulo, 'prenda', a.prenda, 'cliente', a.cliente,
        'ops', a.ops, 'std', round(a.std, 3)) order by a.articulo)
      from (select min(upper(trim(b.articulo))) articulo, min(b.prenda) prenda, min(b.cliente) cliente,
                   count(*) ops, sum(b.std) std
              from bases b where b.area = 'REPROCESO' and coalesce(b.n_op, 0) > 0
             group by _nk(b.articulo)) a), '[]'::json),
    'lotes', coalesce((select json_agg(json_build_object('of', f.o_f, 'articulo', f.articulo, 'cant_prog', f.cant_prog,
        'ops', r.ops, 'completas', r.completas, 'fecha', to_char(f.fecha_carga at time zone 'America/Lima', 'YYYY-MM-DD'))
        order by f.fecha_carga desc)
      from (select * from ofs where reproceso order by fecha_carga desc limit 60) f
      cross join lateral (
        select count(*) ops,
               count(*) filter (where coalesce((select sum(c.cant) from reclamos c
                        where c.area = 'REPROCESO' and c.estado = 'ACTIVO' and _nk(c.o_f) = _nk(f.o_f) and c.nop = x.n_op), 0) >= f.cant_prog) completas
          from (select distinct on (b.n_op) b.n_op from bases b
                 where b.area = 'REPROCESO' and _nk(b.articulo) = _nk(f.articulo) and coalesce(b.n_op, 0) > 0) x) r), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Crea el lote (OF provisional) con su cantidad tope, o corrige la cantidad de uno ya creado.
create or replace function public.fn_reproceso_lote_crear(p_dni text, p_token uuid, p_articulo text, p_lote text, p_cantidad integer)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; f ofs; v_prenda text; v_hecho numeric;
        v_art  text := upper(trim(coalesce(p_articulo,'')));
        v_lote text := upper(trim(coalesce(p_lote,'')));
begin
  o := _auth(p_dni, p_token);
  if not _lote_permiso(o, 'REPROCESO', true) then raise exception 'NO_AUTORIZADA_AREA: no puedes crear lotes en REPROCESO'; end if;
  if v_lote = '' or length(v_lote) > 20 then return json_build_object('ok', false, 'error', 'Escribe el número de lote (máximo 20 letras)'); end if;
  if coalesce(p_cantidad, 0) <= 0 or p_cantidad > 1000000 then return json_build_object('ok', false, 'error', 'Pon la cantidad máxima de prendas'); end if;
  select b.prenda into v_prenda from bases b
   where b.area = 'REPROCESO' and _nk(b.articulo) = _nk(v_art) and coalesce(b.n_op, 0) > 0 order by b.id limit 1;
  if not found then
    return json_build_object('ok', false, 'error', 'REPROCESO no tiene BASE para ' || v_art || '. Súbela en Bases, área REPROCESO.'); end if;
  perform pg_advisory_xact_lock(hashtext('reproceso_lote:' || v_lote));
  select * into f from ofs where _nk(o_f) = _nk(v_lote);
  if found then
    if not f.reproceso then
      return json_build_object('ok', false, 'error', 'Ya existe una OF ' || f.o_f || ' que no es de REPROCESO. Usa otro número de lote.'); end if;
    if _nk(f.articulo) <> _nk(v_art) then
      return json_build_object('ok', false, 'error', 'El lote ' || f.o_f || ' ya existe con el artículo ' || f.articulo); end if;
    select coalesce(max(s), 0) into v_hecho from (select sum(cant) s from reclamos
       where area = 'REPROCESO' and estado = 'ACTIVO' and _nk(o_f) = _nk(f.o_f) group by nop) t;
    if p_cantidad < v_hecho then
      return json_build_object('ok', false, 'error', 'Ya van ' || round(v_hecho, 0) || ' prendas en una operación: la cantidad no puede ser menor'); end if;
    update ofs set cant_prog = p_cantidad where o_f = f.o_f;
    return json_build_object('ok', true, 'of', f.o_f, 'actualizado', true);
  end if;
  insert into ofs (o_f, articulo, prenda, cant_prog, cargado_por, reproceso)
  values (v_lote, v_art, coalesce(v_prenda, ''), p_cantidad, o.dni, true);
  return json_build_object('ok', true, 'of', v_lote);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_reproceso_bases(text, uuid) to anon, authenticated;
grant execute on function public.fn_reproceso_lote_crear(text, uuid, text, text, integer) to anon, authenticated;

commit;
