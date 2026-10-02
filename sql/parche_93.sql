-- PARCHE 93 — Operario · BOLETA (reemplaza "Mis registros")
-- Por cada día de un rango dice si el operario entregó su boleta o no.
-- Nunca muestra eficiencia: solo ENTREGADO / PENDIENTE (y por qué no cuenta).
--
--   ENTREGADO  tiene tickets ACTIVOS ese día, o sus incidencias aprobadas
--              (ocurrencias, sin horas extras) descuentan la jornada completa
--              (≥ 575 min), como quien estuvo todo el día en Despacho.
--   AUSENTE    asistencia del día distinta de ACTIVO (FALTA, DM, VACACIONES…).
--   SIN_LABOR  sábado o domingo sin tickets, día en que su área no registró
--              ningún ticket (feriado, o áreas sin tickets como CORTE) o antes
--              de su primer registro en el sistema.
--   PENDIENTE  el resto: día laborable, presente, sin tickets y sin
--              incidencia de jornada completa.
--
-- Solo lectura; ninguna tabla cambia. Rango máximo 62 días, nunca pasa de hoy.

create or replace function public.fn_mi_boleta(
  p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '30s'
as $function$
declare o operarios; v_ini date; v json;
begin
  o := _auth(p_dni, p_token);
  p_hasta := least(coalesce(p_hasta, _hoy()), _hoy());
  p_desde := coalesce(p_desde, p_hasta - 14);
  if p_hasta < p_desde then
    return json_build_object('ok',false,'error','La fecha final no puede ser menor a la inicial');
  end if;
  if (p_hasta - p_desde) > 61 then
    return json_build_object('ok',false,'error','Rango máximo 62 días');
  end if;

  -- Desde cuándo existe para el sistema: antes de eso no se le exige boleta.
  select least((select min(fecha) from reclamos   where dni = o.dni),
               (select min(fecha) from ocurrencias where dni = o.dni),
               (select min(fecha) from asistencia  where dni = o.dni))
    into v_ini;
  v_ini := coalesce(v_ini, _hoy());

  with dias as (
    select d::date fecha from generate_series(p_desde, p_hasta, interval '1 day') d
  ),
  rec as (
    select fecha, count(*) n, sum(cant) und from reclamos
    where dni = o.dni and estado = 'ACTIVO' and fecha between p_desde and p_hasta
    group by fecha
  ),
  oc as (
    select fecha,
           -sum(minutos) filter (where minutos < 0 and tipo <> 'HORA_EXTRA') desc_min,
           string_agg(distinct nullif(trim(detalle),''), ' · ')
             filter (where minutos < 0 and tipo <> 'HORA_EXTRA') detalle
    from ocurrencias
    where dni = o.dni and fecha between p_desde and p_hasta
    group by fecha
  ),
  sol as (
    select fecha, count(*) n from solicitudes_ajuste
    where dni = o.dni and estado = 'PENDIENTE' and fecha between p_desde and p_hasta
    group by fecha
  ),
  asis as (
    select distinct on (fecha) fecha, estado from asistencia
    where dni = o.dni and fecha between p_desde and p_hasta
    order by fecha, creado desc
  ),
  x as (
    select d.fecha, coalesce(r.n,0) n, coalesce(r.und,0) und,
           coalesce(c.desc_min,0) desc_min, c.detalle, coalesce(s.n,0) sol,
           a.estado asis,
           case
             when coalesce(r.n,0) > 0 then 'ENTREGADO'
             when coalesce(c.desc_min,0) >= 575 then 'ENTREGADO'
             when _ausente(a.estado) then 'AUSENTE'
             when extract(isodow from d.fecha) >= 6 then 'SIN_LABOR'
             when d.fecha < v_ini then 'SIN_LABOR'
             -- Su área no registró nada ese día (feriado, o un área sin
             -- tickets como CORTE o REPROCESO): no se le exige boleta.
             when not exists (select 1 from reclamos z
                              where z.fecha = d.fecha and z.estado = 'ACTIVO'
                                and z.area in (o.area_actual, o.area_origen)) then 'SIN_LABOR'
             else 'PENDIENTE'
           end est
    from dias d
    left join rec  r on r.fecha = d.fecha
    left join oc   c on c.fecha = d.fecha
    left join sol  s on s.fecha = d.fecha
    left join asis a on a.fecha = d.fecha
  )
  select json_build_object('ok', true,
    'desde', to_char(p_desde,'YYYY-MM-DD'), 'hasta', to_char(p_hasta,'YYYY-MM-DD'),
    'hoy', to_char(_hoy(),'YYYY-MM-DD'),
    'entregados', count(*) filter (where est = 'ENTREGADO'),
    'pendientes', count(*) filter (where est = 'PENDIENTE'),
    'dias', coalesce(json_agg(json_build_object(
        'fecha', to_char(fecha,'YYYY-MM-DD'), 'estado', est,
        'tickets', n, 'und', round(und,2),
        'desc_min', round(desc_min), 'detalle', detalle,
        'solicitud', sol > 0,
        'asistencia', case when _ausente(asis) then asis end)
      order by fecha), '[]'::json))
  into v from x;
  return v;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_mi_boleta(text, uuid, date, date) from public;
grant execute on function public.fn_mi_boleta(text, uuid, date, date) to anon, authenticated;
