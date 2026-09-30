-- PARCHE 88 — Auditoría de eficiencias personales, segunda vuelta (solo ALOPEZ)
-- 1) fn_ef_auditoria_v2: la lista marca dos cosas distintas:
--      · días por encima del umbral (por defecto 95%: más que eso es anormal);
--      · PICOS: días que saltan 20 puntos o más sobre el promedio de la propia
--        persona en el rango, aunque no pasen el umbral.
--    Cada fila trae sus "porqués" probables, calculados, no adivinados:
--      INCIDENCIA  sin sus incidencias el día cae bajo el umbral;
--      MULTIAREA   tickets de más de un área el mismo día (575 min en un solo
--                  registro sin separar horas por área);
--      EN_BLOQUE   el 80% o más de sus tickets se registró en 10 minutos;
--      TICKETS_DE_MAS  1.8 veces o más los tickets de su día promedio.
-- 2) fn_ef_auditoria_ops: el día de una persona resumido por OPERACIÓN
--    (cantidades y minutos, no por numeración), con su historial en esa misma
--    operación (60 días) para ver si la cantidad o el tiempo se salen de lo
--    normal. Es también lo que la Edge Function ef-gemini le manda a Gemini.
-- Solo lectura. fn_ef_auditoria (parche 80) se deja para los despliegues viejos.

create or replace function public.fn_ef_auditoria_v2(
  p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text,
  p_umbral numeric, p_pico numeric default 20)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '60s'
as $function$
declare v json; v_u numeric := coalesce(p_umbral, 95); v_p numeric := coalesce(p_pico, 20);
        v_n int; v_tot int; v_picos int;
begin
  perform _admin(p_dni, p_token);
  if p_hasta < p_desde then
    return json_build_object('ok', false, 'error', 'La fecha final no puede ser menor a la inicial'); end if;
  if (p_hasta - p_desde) > 186 then
    return json_build_object('ok', false, 'error', 'Rango máximo 186 días'); end if;

  with prod as (
    select r.dni, r.fecha, sum(r.minutos) prod, count(*) tk, count(distinct r.area) n_areas,
           string_agg(distinct r.area, ' · ') areas_tk
      from reclamos r
     where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO'
     group by 1,2
  ),
  raf as (
    select dni, fecha, max(n) rafaga from (
      select r.dni, r.fecha, count(*) n from reclamos r
       where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO'
       group by r.dni, r.fecha, floor(extract(epoch from r.creado) / 600)) z
     group by 1,2
  ),
  ocu as (
    select oc.dni, oc.fecha, sum(oc.minutos) m, count(*) n
      from ocurrencias oc where oc.fecha between p_desde and p_hasta group by 1,2
  ),
  est as (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
             row_number() over (partition by a.dni, a.fecha order by a.creado desc) rn
        from asistencia a where a.fecha between p_desde and p_hasta) z
     where rn = 1
  ),
  base as (
    select o.dni, o.nombres_apellidos nombre, o.area_actual area, p.fecha,
           coalesce(e.estado,'ACTIVO') estado, p.prod, p.tk, p.n_areas, p.areas_tk,
           coalesce(rf.rafaga, 0) rafaga,
           coalesce(oc.m,0) min_inci, coalesce(oc.n,0) n_inci, 575 + coalesce(oc.m,0) disp
      from prod p
      join operarios o on o.dni = p.dni
      left join raf rf on rf.dni = p.dni and rf.fecha = p.fecha
      left join ocu oc on oc.dni = p.dni and oc.fecha = p.fecha
      left join est e  on e.dni  = p.dni and e.fecha  = p.fecha
     where o.cargo = 'OPERARIO'
       and (coalesce(p_area,'') = '' or o.area_actual = p_area)
  ),
  calc as (
    select b.*,
           case when b.disp > 0 then round(b.prod / b.disp * 100, 1) end ef,
           case when b.min_inci <> 0 then round(b.prod / 575.0 * 100, 1) end ef_sin_inci
      from base b
     where not _ausente(coalesce(b.estado,'ACTIVO'))
  ),
  per as (
    select c.*,
           round(avg(c.ef) over (partition by c.dni), 1) prom,
           count(*) over (partition by c.dni) n_dias,
           avg(c.tk) over (partition by c.dni) prom_tk
      from calc c where c.ef is not null
  ),
  marc as (
    select p.*,
           (p.n_dias >= 3 and p.ef - p.prom >= v_p) pico,
           array_remove(array[
             case when p.n_inci > 0 and p.ef > v_u and coalesce(p.ef_sin_inci, 999) <= v_u then 'INCIDENCIA' end,
             case when p.n_areas > 1 then 'MULTIAREA' end,
             case when p.tk >= 10 and p.rafaga::numeric / p.tk >= 0.8 then 'EN_BLOQUE' end,
             case when p.n_dias >= 3 and p.tk >= 1.8 * p.prom_tk then 'TICKETS_DE_MAS' end
           ], null) porques
      from per p
  )
  select
    coalesce(json_agg(json_build_object(
        'dni', dni, 'nombre', nombre, 'area', area,
        'fecha', to_char(fecha,'YYYY-MM-DD'),
        'prod', round(prod,1), 'disp', round(disp,0), 'ef', ef,
        'tk', tk, 'n_inci', n_inci, 'min_inci', round(min_inci,0),
        'ef_sin_inci', ef_sin_inci, 'prom', prom, 'n_dias', n_dias,
        'pico', pico, 'n_areas', n_areas, 'areas_tk', areas_tk,
        'rafaga', rafaga, 'porques', to_json(porques))
        order by ef desc, fecha desc) filter (where ef > v_u or pico), '[]'::json),
    count(*) filter (where ef > v_u or pico),
    count(*) filter (where pico),
    count(*)
    into v, v_n, v_picos, v_tot
  from marc;

  return json_build_object('ok', true, 'umbral', v_u, 'pico', v_p,
    'items', coalesce(v,'[]'::json),
    'marcados', coalesce(v_n,0), 'picos', coalesce(v_picos,0), 'evaluados', coalesce(v_tot,0));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- El día de una persona por operación. "Historial" = la misma operación (mismo
-- nombre dentro de la misma área, sin importar la OF) en los 60 días previos,
-- de cualquier persona, excluyendo el día auditado. Solo cuentan los días en que
-- esa operación fue al menos el 15% de lo producido, para que el tiempo real no
-- salga de días en que se hizo de pasada.
--   tiempo real por prenda = disponible × (min de la op / min del día) / cantidad
-- Es decir, el turno se reparte entre sus operaciones según lo producido.
create or replace function public.fn_ef_auditoria_ops(
  p_dni text, p_token uuid, p_dni_op text, p_fecha date)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v json; v_prod numeric; v_tk int; v_min numeric; v_prom numeric; v_n int;
begin
  perform _admin(p_dni, p_token);
  select coalesce(sum(minutos),0), count(*) into v_prod, v_tk
    from reclamos where dni = p_dni_op and fecha = p_fecha and estado = 'ACTIVO';
  select coalesce(sum(minutos),0) into v_min from ocurrencias where dni = p_dni_op and fecha = p_fecha;

  -- Promedio de la persona en los 30 días previos (sin el día auditado).
  with d as (
    select r.fecha, sum(r.minutos) prod from reclamos r
     where r.dni = p_dni_op and r.estado = 'ACTIVO'
       and r.fecha between p_fecha - 30 and p_fecha - 1
     group by 1),
  o as (
    select fecha, sum(minutos) m from ocurrencias
     where dni = p_dni_op and fecha between p_fecha - 30 and p_fecha - 1 group by 1)
  select round(avg(d.prod / (575 + coalesce(o.m,0)) * 100), 1), count(*)
    into v_prom, v_n
    from d left join o using (fecha) where 575 + coalesce(o.m,0) > 0;

  with mis as (
    select r.area, r.o_f, r.articulo, r.op, r.nop,
           upper(regexp_replace(r.op, '[^A-Za-z0-9]', '', 'g')) opk, r.std,
           count(*) tk, sum(r.cant) cant, sum(r.minutos) m,
           to_char(min(r.creado) at time zone 'America/Lima','HH24:MI') h_ini,
           to_char(max(r.creado) at time zone 'America/Lima','HH24:MI') h_fin
      from reclamos r
     where r.dni = p_dni_op and r.fecha = p_fecha and r.estado = 'ACTIVO'
     group by 1,2,3,4,5,6,7
  ),
  claves as (select distinct area, opk from mis),
  opd as (
    select r.dni, r.fecha, k.area, k.opk, sum(r.cant) cant, sum(r.minutos) m
      from reclamos r
      join claves k on k.area = r.area
                   and k.opk = upper(regexp_replace(r.op, '[^A-Za-z0-9]', '', 'g'))
     where r.fecha between p_fecha - 60 and p_fecha and r.estado = 'ACTIVO'
       and not (r.dni = p_dni_op and r.fecha = p_fecha)
     group by 1,2,3,4
  ),
  tot as (
    select r.dni, r.fecha, sum(r.minutos) tot from reclamos r
     where r.fecha between p_fecha - 60 and p_fecha and r.estado = 'ACTIVO'
       and (r.dni, r.fecha) in (select dni, fecha from opd)
     group by 1,2
  ),
  ocu as (
    select oc.dni, oc.fecha, sum(oc.minutos) m from ocurrencias oc
     where oc.fecha between p_fecha - 60 and p_fecha
       and (oc.dni, oc.fecha) in (select dni, fecha from opd)
     group by 1,2
  ),
  ded as (
    select o.area, o.opk, o.dni, o.cant,
           (575 + coalesce(c.m,0)) * o.m / t.tot / o.cant t_real
      from opd o join tot t using (dni, fecha) left join ocu c using (dni, fecha)
     where t.tot > 0 and o.m / t.tot >= 0.15 and o.cant > 0 and 575 + coalesce(c.m,0) > 0
  ),
  cmp as (
    select area, opk, count(*) n, count(distinct dni) personas,
           count(*) filter (where dni = p_dni_op) n_propios,
           percentile_cont(0.5) within group (order by cant) cant_med,
           max(cant) cant_max,
           percentile_cont(0.5) within group (order by t_real) t_med,
           percentile_cont(0.25) within group (order by t_real) t_p25
      from ded group by 1,2
  ),
  hoy as (select area, opk, sum(cant) cant_op, sum(m) min_op from mis group by 1,2)
  select coalesce(json_agg(json_build_object(
           'area', m.area, 'of', m.o_f, 'articulo', m.articulo, 'op', m.op, 'nop', m.nop,
           'opk', m.opk, 'std', m.std, 'tk', m.tk, 'cant', m.cant, 'minutos', round(m.m,1),
           'h_ini', m.h_ini, 'h_fin', m.h_fin,
           'cant_op_dia', h.cant_op, 'min_op_dia', round(h.min_op,1),
           'hist_dias', c.n, 'hist_personas', c.personas, 'hist_propios', c.n_propios,
           'hist_cant_med', round(c.cant_med::numeric,0), 'hist_cant_max', c.cant_max,
           'hist_t_med', round(c.t_med::numeric,3), 'hist_t_p25', round(c.t_p25::numeric,3))
           order by h.min_op desc, m.opk, m.o_f), '[]'::json)
    into v
    from mis m join hoy h using (area, opk) left join cmp c using (area, opk);

  return json_build_object('ok', true, 'fecha', to_char(p_fecha,'YYYY-MM-DD'),
    'prod', round(v_prod,1), 'tk', v_tk, 'min_inci', round(v_min,0),
    'disp', round(575 + v_min,0),
    'ef', case when 575 + v_min > 0 then round(v_prod / (575 + v_min) * 100, 1) end,
    'prom_30', v_prom, 'dias_30', coalesce(v_n,0),
    'ops', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
