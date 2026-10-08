-- PARCHE 111 — Asistencia por confirmar (Ingeniería)
-- fn_asistencia_por_confirmar: por área y por día hábil, cuántas personas no
-- registraron tickets ni tienen estado de asistencia ("por confirmar"), y
-- quién viene marcando (supervisora u oficina). Solo lectura; respeta las
-- áreas de Permisos. No cambia tablas ni ningún cálculo.
begin;

create or replace function public.fn_asistencia_por_confirmar(p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare o operarios; v json;
begin
  o := _auth(p_dni, p_token);
  if o.cargo in ('OPERARIO','ESTAJERO','SUPERVISORA') then raise exception 'NO_AUTORIZADA'; end if;
  if p_hasta < p_desde or (p_hasta - p_desde) > 31 then
    return json_build_object('ok', false, 'error', 'Rango inválido (máximo 31 días)');
  end if;
  with mis as (
    select distinct op.area_origen area from operarios op
     where op.cargo = 'OPERARIO' and op.estado = 'ACTIVO' and op.area_origen is not null
       and (coalesce(o.es_admin,false)
            or exists (select 1 from permisos_area pa where pa.dni = o.dni and (pa.area = '*' or pa.area = op.area_origen)))
  ), dias as (
    select d::date fecha from generate_series(p_desde, p_hasta, interval '1 day') d
     where extract(isodow from d) < 6
  ), gente as (
    select op.dni, op.area_origen area from operarios op join mis on mis.area = op.area_origen
     where op.cargo = 'OPERARIO' and op.estado = 'ACTIVO'
  ), pend as (
    select g.area, d.fecha, count(*) n
      from gente g cross join dias d
     where not exists (select 1 from reclamos r where r.fecha = d.fecha and r.dni = g.dni and r.estado = 'ACTIVO')
       and not exists (select 1 from asistencia a where a.dni = g.dni and a.fecha = d.fecha)
     group by g.area, d.fecha
  ), marca as (
    select g.area,
           count(*) filter (where q.cargo = 'SUPERVISORA') sup,
           count(*) filter (where q.cargo is distinct from 'SUPERVISORA') ofi,
           max(a.fecha) filter (where q.cargo = 'SUPERVISORA') ult_sup
      from asistencia a join gente g on g.dni = a.dni
      left join operarios q on q.dni = a.registrado_por
     where a.fecha between p_desde and p_hasta
     group by g.area
  )
  select json_agg(json_build_object(
      'area', m.area,
      'personas', (select count(*) from gente g where g.area = m.area),
      'por_dia', coalesce((select json_object_agg(to_char(p.fecha,'YYYY-MM-DD'), p.n) from pend p where p.area = m.area), '{}'::json),
      'marca_sup', coalesce(k.sup,0), 'marca_ofi', coalesce(k.ofi,0),
      'ult_sup', to_char(k.ult_sup,'YYYY-MM-DD'))
      order by m.area) into v
    from mis m left join marca k on k.area = m.area;
  return json_build_object('ok', true,
    'dias', (select coalesce(json_agg(to_char(fecha,'YYYY-MM-DD') order by fecha), '[]'::json) from (
              select d::date fecha from generate_series(p_desde, p_hasta, interval '1 day') d where extract(isodow from d) < 6) x),
    'areas', coalesce(v, '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_asistencia_por_confirmar(text, uuid, date, date) to anon, authenticated;

commit;
