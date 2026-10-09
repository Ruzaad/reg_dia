-- PARCHE 115 — Paquetes sueltos sin reclamar (solo lectura)
-- Paquetes que nadie reclamó en OFs que ya avanzaron. Una OF sale cuando:
--   * lleva 7 días hábiles sin ningún reclamo en el área (PARADA): cuentan
--     todos sus paquetes libres de operaciones que ya empezaron en el área, o
--   * está EN CURSO pero una operación siguió con paquetes posteriores hace
--     3 días hábiles o más y dejó atrás algunos (SALTADOS).
-- Por qué está suelto: saltado, operación que nadie registró en esa OF (sí en
-- otras OF del área) u operación que nadie registra en ninguna OF desde hace
-- 60 días (revisar BASE). Módulos cerrados no cuentan.
-- Sin tablas nuevas. Pestaña "Paquetes sueltos" (pasoSueltos), repartida por
-- área en Gestión › Permisos; la supervisora ve solo su área.
-- Rollback: parche_115_rollback.sql.
begin;

-- Días hábiles (lunes a viernes) entre dos fechas, sin contar la primera.
create or replace function public._dias_hab(p_desde date, p_hasta date)
 returns integer language sql immutable as $$
  select count(*)::int from generate_series(p_desde + 1, p_hasta, interval '1 day') d
   where extract(isodow from d) < 6
$$;

-- Áreas que ve quien consulta (null = todas). Supervisora: la suya.
create or replace function public._sueltos_areas(p_dni text, p_token uuid, p_area text)
 returns text[] language plpgsql stable security definer set search_path to 'public' as $$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  if o.cargo = 'SUPERVISORA' then return array[o.area_actual]; end if;
  perform _vista(p_dni, p_token, array['pasoSueltos','pasoAudit'], nullif(p_area,''));
  if coalesce(o.es_admin,false) or exists (select 1 from permisos_area where dni = o.dni and area = '*') then
    return case when nullif(p_area,'') is null then null else array[p_area] end;
  end if;
  return coalesce((select array_agg(area) from permisos_area where dni = o.dni
                    and (nullif(p_area,'') is null or area = p_area)), '{}');
end $$;
revoke all on function public._sueltos_areas(text, uuid, text) from public, anon, authenticated;

-- Base de todo: un paquete libre por fila, con su motivo. p_of acota a una OF.
-- Una sola pasada con ventanas: para cada paquete, el primer día en que se
-- registró un paquete POSTERIOR de la misma operación (salto) y el último
-- reclamo de la OF en el área (ult).
create or replace function public._sueltos(p_areas text[], p_of text)
 returns table(area text, o_f text, articulo text, modulo text, op text, n_op integer, paq integer,
               minutos numeric, motivo text, liberado boolean, parada boolean, ult date, salto date)
 language sql stable security definer set search_path to 'public' as $$
  with hoy as (select _hoy() h),
  lim as (                       -- último día que ya cumple 7 y 3 días hábiles
    select max(x::date) filter (where _dias_hab(x::date, h) >= 7) l7,
           max(x::date) filter (where _dias_hab(x::date, h) >= 3) l3
      from hoy, generate_series(h - 30, h, interval '1 day') x
  ),
  ofa as (                       -- OF que ya empezaron en el área (activas en 120 días)
    select r.area, r.o_f from reclamos r
     where r.estado = 'ACTIVO' and r.area <> 'ACABADO'
       and (p_areas is null or r.area = any(p_areas)) and (p_of is null or r.o_f = p_of)
     group by 1, 2 having max(r.fecha) >= _hoy() - 120
  ),
  ra as (                        -- reclamos activos de esas áreas (se cruzan de una vez)
    select r.area, r.codigo, r.fecha from reclamos r
     where r.estado = 'ACTIVO' and r.area <> 'ACABADO'
       and (p_areas is null or r.area = any(p_areas)) and (p_of is null or r.o_f = p_of)
  ),
  t as (
    select t.area, t.o_f, t.articulo, t.modulo, t.op, t.n_op, t.paq, t.codigo, t.std * t.cant mi, r.fecha,
           max(r.fecha) over (partition by t.area, t.o_f) ult,
           count(r.fecha) over (partition by t.area, t.o_f, t.n_op) hechos,
           min(r.fecha) over (partition by t.area, t.o_f, t.n_op order by t.paq desc
                              rows between unbounded preceding and 1 preceding) salto
      from tickets_cache t
      join ofa a on a.area = t.area and a.o_f = t.o_f
      left join ra r on r.area = t.area and r.codigo = t.codigo
     where not exists (select 1 from modulos_cerrados m where m.area = t.area and m.o_f = t.o_f and m.modulo = t.modulo)
  ),
  -- Búsquedas por clave (jsonb): miles de consultas en un instante, sin
  -- cruzar tablas fila por fila.
  viva as (                      -- operaciones que alguien registró en el área (60 días)
    select coalesce(jsonb_object_agg(k, true), '{}') j from (
      select distinct r.area || '|' || r.op k from reclamos r, hoy
       where r.estado = 'ACTIVO' and r.fecha >= hoy.h - 60
         and (p_areas is null or r.area = any(p_areas))) z where k is not null
  ),
  lib as (
    select coalesce(jsonb_object_agg(k, true), '{}') j from (
      select distinct r.area || '|' || r.codigo k from reclamos r
       where r.estado = 'LIBERADO' and (p_areas is null or r.area = any(p_areas)) and (p_of is null or r.o_f = p_of)) z where k is not null
  ),
  l as materialized (
    select t.*, t.ult <= (select l7 from lim) parada
      from t where t.fecha is null
       and (t.ult <= (select l7 from lim) or t.salto <= (select l3 from lim))
  )
  select l.area, l.o_f, l.articulo, l.modulo, l.op, l.n_op, l.paq, round(l.mi, 1) minutos,
         case when l.salto is not null or l.hechos > 0 then 'SALTADO'
              when (select j from viva) ? (l.area || '|' || l.op) then 'SIN_REGISTRAR'
              else 'NADIE' end motivo,
         (select j from lib) ? (l.area || '|' || l.codigo) liberado, l.parada, l.ult, l.salto
    from l
$$;
revoke all on function public._sueltos(text[], text) from public, anon, authenticated;

-- Resumen: una fila por OF y área.
create or replace function public.fn_paquetes_sueltos(p_dni text, p_token uuid, p_area text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set work_mem to '32MB'          -- ordena ~160 mil paquetes en memoria (2.5 s con todas las áreas)
as $function$
declare v_areas text[];
begin
  v_areas := _sueltos_areas(p_dni, p_token, p_area);
  return json_build_object('ok', true, 'hoy', _hoy(), 'items', coalesce((
    select json_agg(x order by x.min desc) from (
      select s.area, s.o_f, max(s.articulo) articulo, bool_or(s.parada) parada, max(s.ult) ult, min(s.salto) hueco,
             _dias_hab(case when bool_or(s.parada) then max(s.ult) else min(s.salto) end, _hoy()) dias,
             count(*) paq, round(sum(s.minutos)) min, count(distinct s.n_op) ops,
             count(*) filter (where s.motivo = 'SALTADO') saltados,
             count(*) filter (where s.motivo = 'SIN_REGISTRAR') sin_registrar,
             count(*) filter (where s.motivo = 'NADIE') nadie,
             count(*) filter (where s.liberado) liberados,
             (select max(r.fecha) from reclamos r where r.area = 'ACABADO' and r.o_f = s.o_f and r.estado = 'ACTIVO') acabado
        from _sueltos(v_areas, null) s
       group by s.area, s.o_f) x), '[]'::json),
    'sin_generar', (select count(*) from ofs f where f.fecha_carga < now() - interval '14 days'
                      and not exists (select 1 from tickets_cache t where t.o_f = f.o_f)));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Detalle de una OF: una fila por operación, con quién hizo la mayoría.
create or replace function public.fn_paquetes_sueltos_of(p_dni text, p_token uuid, p_area text, p_of text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_areas text[];
begin
  v_areas := _sueltos_areas(p_dni, p_token, p_area);
  if v_areas is not null and not (p_area = any(v_areas)) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a %', p_area; end if;
  return json_build_object('ok', true, 'ops', coalesce((
    select json_agg(x order by x.min desc) from (
      select g.*, q.nombre, q.n, q.tot from (
        select s.modulo, s.op, s.n_op, array_agg(s.paq order by s.paq) paqs, round(sum(s.minutos)) min,
               min(s.motivo) motivo, min(s.salto) desde, count(*) filter (where s.liberado) liberados
          from _sueltos(array[p_area], p_of) s
         group by s.modulo, s.op, s.n_op) g
      left join lateral (
        select o.nombres_apellidos nombre, count(*) n, sum(count(*)) over () tot
          from reclamos r join operarios o on o.dni = r.dni
         where r.area = p_area and r.o_f = p_of and r.nop = g.n_op and r.estado = 'ACTIVO'
         group by o.nombres_apellidos order by 2 desc limit 1) q on true) x), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
