begin;
create or replace function public.fn_tickets_of(p_dni text, p_token uuid, p_area text, p_of text)
 returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return json_build_object(
    'tickets', coalesce((select json_agg(json_build_object(
        'codigo', t.codigo, 'of', t.o_f, 'articulo', t.articulo, 'modulo', t.modulo,
        'op', t.op, 'nop', t.n_op, 'op_id', t.op_id, 'std', t.std, 'cant', t.cant,
        'talla', t.talla, 'color', t.color, 'corte', t.paq::text,
        'num', t.desde::text || '-' || t.hasta::text)
        order by t.o_f, t.n_op, t.paq)
      from tickets_cache t
     where t.area = p_area and t.o_f = p_of), '[]'::json),
    'reclamados', coalesce((select json_agg(json_build_object(
        'codigo', r.codigo,
        'nombre', op2.nombres_apellidos,
        'hora', to_char(r.creado at time zone 'America/Lima','HH24:MI')))
      from reclamos r join operarios op2 on op2.dni = r.dni
     where r.area = p_area and r.o_f = p_of and r.estado = 'ACTIVO'), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
commit;
