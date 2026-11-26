begin;
create or replace function public.fn_reclamados(p_dni text, p_token uuid, p_area text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _auth(p_dni, p_token);
  return coalesce((
    select json_agg(json_build_object('codigo', r.codigo,
      'nombre', o.nombres_apellidos,
      'hora', to_char(r.creado at time zone 'America/Lima','HH24:MI')))
    from reclamos r join operarios o on o.dni = r.dni
    where r.area = p_area and r.estado = 'ACTIVO'
  ), '[]'::json);
end $function$;
commit;
