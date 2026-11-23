-- Deshacer parche 175
begin;
drop function if exists public.fn_solicitud_borrar(text, uuid, bigint);
create or replace function public.fn_ocurrencias_listar(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _lector(p_dni, p_token, p_area);
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object(
      'id', oc.id, 'dni', oc.dni, 'nombre', o.nombres_apellidos, 'area', oc.area,
      'tipo', oc.tipo, 'minutos', oc.minutos, 'detalle', oc.detalle,
      'fecha', to_char(oc.fecha,'YYYY-MM-DD'),
      'registrado_por', coalesce(sup.nombres_apellidos, oc.supervisora_dni),
      'hora', to_char(oc.creado at time zone 'America/Lima','HH24:MI'))
      order by oc.fecha desc, oc.creado desc)
    from ocurrencias oc
    join operarios o on o.dni = oc.dni
    left join operarios sup on sup.dni = oc.supervisora_dni
    where (coalesce(p_area,'') = '' or oc.area = p_area)
      and (p_desde is null or oc.fecha >= p_desde)
      and (p_hasta is null or oc.fecha <= p_hasta)
  ), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
commit;
