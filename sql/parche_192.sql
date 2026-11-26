-- Parche 192 — fn_reclamados trae la cantidad hecha, la asignada y el paquete padre
-- Para que el operario vea «Hizo 2 de 10» y «Resto 8» en un paquete ajustado, no solo «10 und».
-- Solo agrega campos al JSON: el front viejo los ignora.
begin;
create or replace function public.fn_reclamados(p_dni text, p_token uuid, p_area text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _auth(p_dni, p_token);
  return coalesce((
    select json_agg(json_build_object('codigo', r.codigo,
      'nombre', o.nombres_apellidos,
      'hora', to_char(r.creado at time zone 'America/Lima','HH24:MI'),
      'cant', round(r.cant,0),
      'asig', round(coalesce(r.cant_asignada, r.cant),0),
      'padre', r.codigo_padre))
    from reclamos r join operarios o on o.dni = r.dni
    where r.area = p_area and r.estado = 'ACTIVO'
  ), '[]'::json);
end $function$;
commit;
