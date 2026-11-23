-- PARCHE 175 — Incidencias de Ingeniería: el área sale de la ESTRUCTURA del mes y se pueden borrar pedidos sin avisar.
-- 1) fn_ocurrencias_listar (misma firma): agrega area_est (área de la estructura del mes de la incidencia) y el filtro por área
--    usa la estructura; si la persona no está en la estructura de ese mes, cae al área con que se registró.
-- 2) fn_solicitud_borrar: Ingeniería borra un pedido PENDIENTE o RECHAZADO sin pedir motivo y sin avisar al operario (desaparece de su lista).
--    Un pedido APROBADO no se borra aquí: se borra su incidencia (fn_ocurrencia_eliminar), que ya lo anula.
-- Rollback: parche_175_rollback.sql
begin;

create or replace function public.fn_ocurrencias_listar(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _lector(p_dni, p_token, p_area);
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object(
      'id', oc.id, 'dni', oc.dni, 'nombre', o.nombres_apellidos, 'area', oc.area, 'area_est', em.area,
      'tipo', oc.tipo, 'minutos', oc.minutos, 'detalle', oc.detalle,
      'fecha', to_char(oc.fecha,'YYYY-MM-DD'),
      'registrado_por', coalesce(sup.nombres_apellidos, oc.supervisora_dni),
      'hora', to_char(oc.creado at time zone 'America/Lima','HH24:MI'))
      order by oc.fecha desc, oc.creado desc)
    from ocurrencias oc
    join operarios o on o.dni = oc.dni
    left join operarios sup on sup.dni = oc.supervisora_dni
    left join estructura_mes em on em.dni = oc.dni and em.mes = date_trunc('month', oc.fecha)::date
    where (coalesce(p_area,'') = '' or coalesce(em.area, oc.area) = p_area)
      and (p_desde is null or oc.fecha >= p_desde)
      and (p_hasta is null or oc.fecha <= p_hasta)
  ), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_solicitud_borrar(p_dni text, p_token uuid, p_id bigint)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare quien operarios; sol solicitudes_ajuste;
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  select * into sol from solicitudes_ajuste where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Solicitud no encontrada'); end if;
  if not _aprueba(quien, sol.area) then raise exception 'NO_AUTORIZADA_AREA: no administras incidencias de %', sol.area; end if;
  if sol.estado = 'APROBADO' then
    return json_build_object('ok', false, 'error', 'Ya está aprobada: borra la incidencia desde Aplicadas');
  end if;
  delete from solicitudes_ajuste where id = p_id;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_solicitud_borrar(text, uuid, bigint) from public;
grant execute on function public.fn_solicitud_borrar(text, uuid, bigint) to anon, authenticated;
commit;
