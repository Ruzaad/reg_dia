-- PARCHE 84 — Tickets · RESUMEN X OPERARIO
-- Qué hace cada operario en un rango de fechas: sus operaciones sumadas en
-- unidades (sin distinguir OF), cuánto rinde en cada una contra la meta y
-- contra el promedio de los demás que hicieron esa misma operación.
--
-- La base no guarda el tiempo por operación (los tickets se registran en
-- tandas), así que el tiempo de cada operación se reparte: el disponible del
-- día (575 + incidencias, la misma regla de fn_eficiencia_rango) se divide
-- entre las operaciones de ese día según los minutos estándar producidos en
-- cada una. Eficiencia de la operación = producido / tiempo repartido.
--
-- Solo tickets ACTIVOS. Solo lectura; ninguna tabla cambia.

create or replace function public.fn_resumen_operario(
  p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text default '')
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '60s'
as $function$
declare v json;
begin
  perform _ing(p_dni, p_token);
  if p_hasta < p_desde then
    return json_build_object('ok',false,'error','La fecha final no puede ser menor a la inicial');
  end if;
  if (p_hasta - p_desde) > 92 then
    return json_build_object('ok',false,'error','Rango máximo 93 días');
  end if;

  with r as (
    select dni, fecha, area,
           -- "HABILITAR SACO (INGRESO )" y "(INGRESO)" son la misma operación
           coalesce(nullif(replace(replace(regexp_replace(upper(trim(op)),'\s+',' ','g'),
             '( ','('),' )',')'),''),'(SIN OPERACIÓN)') op,
           coalesce(cant,0) und, coalesce(minutos,0) prod
    from reclamos
    where fecha between p_desde and p_hasta and estado = 'ACTIVO'
  ),
  gente as (          -- quien produjo algo en el área pedida
    select distinct dni from r where coalesce(p_area,'') = '' or area = p_area
  ),
  dias as (select d::date f from generate_series(p_desde, p_hasta, interval '1 day') d),
  est as (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
             row_number() over (partition by a.dni, a.fecha order by a.creado desc) rn
      from asistencia a join gente g on g.dni = a.dni
      where a.fecha between p_desde and p_hasta) z
    where rn = 1
  ),
  ocu as (
    select oc.dni, oc.fecha, sum(oc.minutos) m
    from ocurrencias oc join gente g on g.dni = oc.dni
    where oc.fecha between p_desde and p_hasta group by 1,2
  ),
  prod_d as (         -- todo el día de la persona, en cualquier área
    select r.dni, r.fecha, sum(r.prod) prod
    from r join gente g on g.dni = r.dni group by 1,2
  ),
  dia as (            -- misma regla de disponible que fn_eficiencia_rango
    select g.dni, dd.f, coalesce(pd.prod,0) prod,
      case when _ausente(e.estado) then 0
           else (case when extract(dow from dd.f) in (0,6) and pd.dni is null then 0 else 575 end)
                + coalesce(oc.m,0) end disp
    from gente g cross join dias dd
    left join est    e  on e.dni  = g.dni and e.fecha  = dd.f
    left join prod_d pd on pd.dni = g.dni and pd.fecha = dd.f
    left join ocu    oc on oc.dni = g.dni and oc.fecha = dd.f
  ),
  opd as (            -- persona × operación × día, con su parte del turno
    select r.dni, r.area, r.op, r.fecha, sum(r.und) und, sum(r.prod) prod,
           case when max(d.prod) > 0 then max(d.disp) * sum(r.prod) / max(d.prod) else 0 end asig
    from r join dia d on d.dni = r.dni and d.f = r.fecha
    where coalesce(p_area,'') = '' or r.area = p_area
    group by 1,2,3,4
  ),
  op_p as (
    select dni, area, op, sum(und) und, sum(prod) prod, sum(asig) asig, count(*) dias,
           json_object_agg(to_char(fecha,'YYYY-MM-DD'), round(und,1)) por_dia
    from opd group by 1,2,3
  ),
  prom as (
    select area, op, count(distinct dni) n, sum(und) / count(*) und_dia,
           case when sum(asig) > 0 then sum(prod) / sum(asig) * 100 end ef
    from opd group by 1,2
  ),
  per as (
    select d.dni, sum(d.prod) prod, sum(d.disp) disp,
           count(*) filter (where d.prod > 0) dias
    from dia d group by 1
  )
  select json_build_object('ok', true,
    'dias', (select json_agg(to_char(f,'YYYY-MM-DD') order by f) from dias),
    'prom', coalesce((select json_agg(json_build_object(
        'area', area, 'op', op, 'n', n, 'und_dia', round(und_dia,1), 'ef', round(ef,1)))
      from prom), '[]'::json),
    'personal', coalesce((select json_agg(json_build_object(
        'dni', p.dni, 'nombre', o.nombres_apellidos, 'area', o.area_actual,
        'dias', p.dias, 'prod', round(p.prod,1), 'disp', round(p.disp,0),
        'ef', case when p.disp > 0 then round(p.prod / p.disp * 100, 1) end,
        'ops', (select json_agg(json_build_object(
            'area', x.area, 'op', x.op, 'und', round(x.und,1), 'prod', round(x.prod,1),
            'asig', round(x.asig,0), 'dias', x.dias, 'por_dia', x.por_dia,
            'ef', case when x.asig > 0 then round(x.prod / x.asig * 100, 1) end)
            order by x.und desc)
          from op_p x where x.dni = p.dni))
        order by o.nombres_apellidos)
      from per p join operarios o on o.dni = p.dni), '[]'::json))
  into v;
  return v;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_resumen_operario(text, uuid, date, date, text) from public;
grant execute on function public.fn_resumen_operario(text, uuid, date, date, text) to anon, authenticated;
