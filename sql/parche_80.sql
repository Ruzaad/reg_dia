-- PARCHE 80 — Auditoría de eficiencia (solo administrador maestro)
-- Días-persona por encima de un umbral. Un operario no debería pasar de ~90%:
-- o su tiempo está mal tomado, o está reclamando tickets de más.
-- La eficiencia es la misma de la pantalla "Eficiencia":
--     ef = producido (tickets ACTIVOS) / (575 + minutos de incidencias) * 100
-- Casi toda incidencia trae minutos NEGATIVOS, así que achica el denominador
-- y SUBE el porcentaje. Por eso el detalle permite simular la corrección.

create or replace function public.fn_ef_auditoria(
  p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text, p_umbral numeric)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '60s'
as $function$
declare v json; v_umbral numeric := coalesce(p_umbral, 90); v_n int; v_tot int;
begin
  perform _admin(p_dni, p_token);
  if p_hasta < p_desde then
    return json_build_object('ok', false, 'error', 'La fecha final no puede ser menor a la inicial'); end if;
  if (p_hasta - p_desde) > 186 then
    return json_build_object('ok', false, 'error', 'Rango máximo 186 días'); end if;

  with prod as (
    select r.dni, r.fecha, sum(r.minutos) prod, count(*) tk
      from reclamos r
     where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO'
     group by 1,2
  ),
  ocu as (
    select oc.dni, oc.fecha, sum(oc.minutos) m, count(*) n
      from ocurrencias oc
     where oc.fecha between p_desde and p_hasta
     group by 1,2
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
           coalesce(e.estado,'ACTIVO') estado,
           p.prod, p.tk,
           coalesce(oc.m,0) min_inci, coalesce(oc.n,0) n_inci,
           575 + coalesce(oc.m,0) disp
      from prod p
      join operarios o on o.dni = p.dni
      left join ocu oc on oc.dni = p.dni and oc.fecha = p.fecha
      left join est e  on e.dni  = p.dni and e.fecha  = p.fecha
     where o.cargo = 'OPERARIO'
       and (coalesce(p_area,'') = '' or o.area_actual = p_area)
  ),
  calc as (
    select b.*,
           case when b.disp > 0 then round(b.prod / b.disp * 100, 1) end ef,
           /* A cuánto caería sin NINGUNA incidencia: cuánto del exceso explica. */
           case when b.min_inci <> 0 then round(b.prod / 575.0 * 100, 1) end ef_sin_inci
      from base b
     where not _ausente(coalesce(b.estado,'ACTIVO'))
  )
  /* Un solo statement: el CTE no sobrevive a la siguiente sentencia, así que
     la lista y los dos contadores salen de aquí con agregados filtrados. */
  select
    coalesce(json_agg(json_build_object(
        'dni', dni, 'nombre', nombre, 'area', area,
        'fecha', to_char(fecha,'YYYY-MM-DD'),
        'prod', round(prod,1), 'disp', round(disp,0), 'ef', ef,
        'tk', tk, 'n_inci', n_inci, 'min_inci', round(min_inci,0),
        'ef_sin_inci', ef_sin_inci)
        order by ef desc, fecha desc) filter (where ef > v_umbral), '[]'::json),
    count(*) filter (where ef > v_umbral),
    count(*)
    into v, v_n, v_tot
  from calc where ef is not null;

  return json_build_object('ok', true, 'umbral', v_umbral,
    'items', coalesce(v,'[]'::json),
    'marcados', coalesce(v_n,0), 'evaluados', coalesce(v_tot,0));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Detalle de un día-persona: sus incidencias (para simular) y sus tickets.
create or replace function public.fn_ef_auditoria_detalle(
  p_dni text, p_token uuid, p_dni_op text, p_fecha date)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare o operarios; v_prod numeric; v_tk int; v_min numeric; v_est text; v_efm numeric;
begin
  perform _admin(p_dni, p_token);
  select * into o from operarios where dni = p_dni_op;
  if not found then return json_build_object('ok', false, 'error', 'No existe ese DNI'); end if;

  select coalesce(sum(minutos),0), count(*) into v_prod, v_tk
    from reclamos where dni = p_dni_op and fecha = p_fecha and estado = 'ACTIVO';
  select coalesce(sum(minutos),0) into v_min from ocurrencias where dni = p_dni_op and fecha = p_fecha;
  select estado into v_est from asistencia
   where dni = p_dni_op and fecha = p_fecha order by creado desc limit 1;
  select pct into v_efm from eficiencia_manual where dni = p_dni_op and fecha = p_fecha;

  return json_build_object('ok', true,
    'dni', o.dni, 'nombre', o.nombres_apellidos, 'area', o.area_actual,
    'categoria', o.categoria, 'area_origen', o.area_origen,
    'fecha', to_char(p_fecha,'YYYY-MM-DD'),
    'estado', coalesce(v_est,'ACTIVO'),
    'prod', round(v_prod,1), 'tk', v_tk,
    'min_inci', round(v_min,0), 'disp', round(575 + v_min,0),
    'ef_manual', v_efm,
    'incidencias', coalesce((
      select json_agg(json_build_object(
        'id', oc.id, 'tipo', oc.tipo, 'minutos', oc.minutos, 'detalle', oc.detalle,
        'area', oc.area,
        'registrado_por', coalesce(sup.nombres_apellidos, oc.supervisora_dni),
        'hora', to_char(oc.creado at time zone 'America/Lima','HH24:MI'))
        order by oc.creado)
      from ocurrencias oc
      left join operarios sup on sup.dni = oc.supervisora_dni
      where oc.dni = p_dni_op and oc.fecha = p_fecha), '[]'::json),
    'tickets', coalesce((
      select json_agg(json_build_object(
        'id', r.id,
        'hora', to_char(r.creado at time zone 'America/Lima','HH24:MI'),
        'area', r.area, 'of', r.o_f, 'op', r.op, 'nop', r.nop,
        'cant', r.cant, 'minutos', round(r.minutos,1), 'num', r.numeracion)
        order by r.creado)
      from reclamos r
      where r.dni = p_dni_op and r.fecha = p_fecha and r.estado = 'ACTIVO'), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Aplicar el cambio reutiliza fn_ocurrencia_editar / fn_ocurrencia_eliminar,
-- que ya existen: no se crea ninguna RPC de escritura nueva.
