-- =====================================================================
-- PARCHE 96 — Pantalla de Costos (solo lectura)
-- Cuatro RPC de lectura para las pestañas de Costos de ingenieria.html:
-- Base (balance de línea), Reporte de hoy, Incidencias y Asistencia.
-- No escriben nada. Validan con _lector (parche 95): pasa el admin o quien
-- tenga LEER/EDITAR en el área pedida; área vacía = todas (permiso '*').
-- Requiere el parche 95 aplicado antes.
-- =====================================================================
do $$ begin
  if to_regprocedure('public._lector(text,uuid,text)') is null then
    raise exception 'Falta _lector: aplica primero el parche 95 (permisos por área)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) BASE de un área: lo mismo que fn_bases_listar, sin datos de auditoría.
-- ---------------------------------------------------------------------
create or replace function public.fn_costos_base(p_dni text, p_token uuid, p_area text)
returns json language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(p_area,'') = '' then raise exception 'Indica el área'; end if;
  perform _lector(p_dni, p_token, p_area);
  return coalesce((select json_agg(json_build_object(
      'prenda', prenda, 'cliente', cliente, 'modulo', modulo, 'articulo', articulo,
      'operacion', operacion, 'std', std, 'max_op', max_op, 'n_op', n_op)
      order by articulo, n_op)
    from bases where area = p_area), '[]'::json);
end $$;

-- ---------------------------------------------------------------------
-- 2) REPORTE DE HOY: tickets ACTIVOS del día sumados por área, artículo,
--    OF, operación y N°OP; la última y penúltima operación (N°OP) de cada
--    artículo según su BASE, y las incidencias del día. La elección
--    última/penúltima se hace en el cliente sin volver a pedir datos.
-- ---------------------------------------------------------------------
create or replace function public.fn_costos_reporte(p_dni text, p_token uuid, p_fecha date, p_area text default '')
returns json language plpgsql security definer set search_path = public
as $$
declare v_tk json; v_ult json; v_inc json;
begin
  perform _lector(p_dni, p_token, coalesce(p_area,''));
  if p_fecha is null then raise exception 'Indica la fecha'; end if;

  with t as (
    select r.area, upper(trim(r.articulo)) art, r.o_f, r.op, r.nop,
           sum(r.cant) cant, count(*) tks
      from reclamos r
     where r.fecha = p_fecha and r.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or r.area = p_area)
     group by 1,2,3,4,5
  )
  select coalesce(json_agg(json_build_object('area', area, 'articulo', art, 'of', o_f,
           'op', op, 'nop', nop, 'cant', cant, 'tks', tks)), '[]'::json)
    into v_tk from t;

  with arts as (
    select distinct r.area, upper(trim(r.articulo)) art
      from reclamos r
     where r.fecha = p_fecha and r.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or r.area = p_area)
  ), b as (
    select distinct b.area, a.art, b.n_op
      from bases b join arts a on a.area = b.area and upper(trim(b.articulo)) = a.art
     where b.n_op > 0
  ), k as (
    select area, art, n_op, dense_rank() over (partition by area, art order by n_op desc) k from b
  )
  select coalesce(json_agg(json_build_object('area', area, 'articulo', art, 'n1', n1, 'n2', n2)), '[]'::json)
    into v_ult
    from (select area, art, max(n_op) filter (where k = 1) n1, max(n_op) filter (where k = 2) n2
            from k group by area, art) z;

  select coalesce(json_agg(json_build_object(
      'nombre', o.nombres_apellidos, 'area', oc.area, 'tipo', oc.tipo,
      'minutos', oc.minutos, 'detalle', oc.detalle,
      'hora', to_char(oc.creado at time zone 'America/Lima','HH24:MI'))
      order by oc.creado desc), '[]'::json)
    into v_inc
    from ocurrencias oc join operarios o on o.dni = oc.dni
   where oc.fecha = p_fecha and (coalesce(p_area,'') = '' or oc.area = p_area);

  return json_build_object('ok', true, 'fecha', to_char(p_fecha,'YYYY-MM-DD'),
    'tickets', v_tk, 'ultimas', v_ult, 'incidencias', v_inc);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------------------------------------------------------------------
-- 3) INCIDENCIAS de un rango (máx. 93 días).
-- ---------------------------------------------------------------------
create or replace function public.fn_costos_incidencias(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
returns json language plpgsql security definer set search_path = public
as $$
begin
  perform _lector(p_dni, p_token, coalesce(p_area,''));
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    return json_build_object('ok', false, 'error', 'Rango de fechas inválido');
  end if;
  if p_hasta - p_desde > 93 then
    return json_build_object('ok', false, 'error', 'El rango máximo es de 3 meses');
  end if;
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object(
      'fecha', to_char(oc.fecha,'YYYY-MM-DD'),
      'hora', to_char(oc.creado at time zone 'America/Lima','HH24:MI'),
      'nombre', o.nombres_apellidos, 'area', oc.area, 'tipo', oc.tipo,
      'minutos', oc.minutos, 'detalle', oc.detalle,
      'registrado_por', coalesce(sup.nombres_apellidos, oc.supervisora_dni))
      order by oc.fecha desc, oc.creado desc)
    from ocurrencias oc
    join operarios o on o.dni = oc.dni
    left join operarios sup on sup.dni = oc.supervisora_dni
    where (coalesce(p_area,'') = '' or oc.area = p_area)
      and oc.fecha between p_desde and p_hasta), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------------------------------------------------------------------
-- 4) ASISTENCIA del día: el personal (operarios activos por área de
--    origen) con su estado efectivo. Igual que la lista de marcar: con al
--    menos un ticket del día cuenta como ACTIVO aunque tenga otra marca;
--    sin marca ni tickets queda en null (sin marcar).
-- ---------------------------------------------------------------------
create or replace function public.fn_costos_asistencia(p_dni text, p_token uuid, p_area text, p_fecha date)
returns json language plpgsql security definer set search_path = public
as $$
declare v_fecha date := coalesce(p_fecha, _hoy()); v json;
begin
  perform _lector(p_dni, p_token, coalesce(p_area,''));
  select coalesce(json_agg(json_build_object(
      'nombre', z.nombre, 'area', z.area_origen, 'area_actual', z.area_actual,
      'estado', case when z.tickets > 0 then 'ACTIVO' else z.estado end,
      'estado_guardado', z.estado, 'tickets', z.tickets)
      order by z.area_origen, z.nombre), '[]'::json)
    into v
  from (
    select o.nombres_apellidos nombre, o.area_origen, o.area_actual,
           (select a.estado from asistencia a
             where a.dni = o.dni and a.fecha = v_fecha
             order by a.creado desc limit 1) estado,
           (select count(*) from reclamos r
             where r.dni = o.dni and r.fecha = v_fecha and r.estado = 'ACTIVO') tickets
      from operarios o
     where o.cargo = 'OPERARIO' and o.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or o.area_origen = p_area)
  ) z;
  return json_build_object('ok', true, 'fecha', to_char(v_fecha,'YYYY-MM-DD'), 'personal', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- Solo se llaman desde la app (anon), como el resto de RPC con token.
revoke all on function public.fn_costos_base(text, uuid, text) from public;
revoke all on function public.fn_costos_reporte(text, uuid, date, text) from public;
revoke all on function public.fn_costos_incidencias(text, uuid, text, date, date) from public;
revoke all on function public.fn_costos_asistencia(text, uuid, text, date) from public;
grant execute on function public.fn_costos_base(text, uuid, text) to anon, authenticated;
grant execute on function public.fn_costos_reporte(text, uuid, date, text) to anon, authenticated;
grant execute on function public.fn_costos_incidencias(text, uuid, text, date, date) to anon, authenticated;
grant execute on function public.fn_costos_asistencia(text, uuid, text, date) to anon, authenticated;
