-- ROLLBACK del PARCHE 92: quita la guardia de la tabla y deja fn_reclamar y
-- fn_reclamar_lote como estaban (copiadas de producción el 2 oct 2026).
-- No devuelve a LFABIAN a CAMISA COSTURA.
begin;

drop trigger if exists reclamos_solo_planta_trg on public.reclamos;
drop function if exists public._reclamo_solo_planta();

CREATE OR REPLACE FUNCTION public.fn_reclamar(p_dni text, p_token uuid, p_area text, p_codigo text, p_of text, p_modulo text, p_op text, p_std numeric, p_cant numeric, p_numeracion text, p_articulo text, p_color text, p_talla text, p_corte text, p_nop integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o operarios; quien text; cuando text; res residuales; v_esp numeric; v_padre text;
begin
  o := _auth(p_dni, p_token);
  if _modulo_cerrado(p_area, p_of, p_modulo) then
    return json_build_object('ok', false, 'error',
      'El módulo '||coalesce(p_modulo,'')||' (OF '||coalesce(p_of,'')||') está cerrado por ingeniería.');
  end if;

  select * into res from residuales where area = p_area and codigo = p_codigo;
  if found then
    v_esp := res.cant; v_padre := res.codigo_padre;
  else
    v_esp := _paq_cant(p_area, p_of, p_nop, _int(p_corte));
  end if;

  if v_esp is not null and p_cant is distinct from v_esp then
    return json_build_object('ok', false, 'error',
      'La cantidad no cuadra: el paquete es de '||round(v_esp,0)||' und. Recarga el almacén.');
  end if;

  begin
    insert into reclamos (codigo, codigo_padre, dni, area, o_f, modulo, op, std, cant,
                          cant_asignada, numeracion, articulo, color, talla, corte, nop)
    values (p_codigo, v_padre, o.dni, p_area, p_of, p_modulo, p_op, p_std, p_cant,
            coalesce(v_esp, p_cant), p_numeracion, p_articulo, p_color, p_talla, p_corte, p_nop);
  exception when unique_violation then
    select op2.nombres_apellidos,
           to_char(r.creado at time zone 'America/Lima','HH24:MI')
      into quien, cuando
      from reclamos r join operarios op2 on op2.dni = r.dni
     where r.codigo = p_codigo and r.area = p_area and r.estado = 'ACTIVO' limit 1;
    return json_build_object('ok', false, 'conflicto', true,
      'error', 'Ya lo tomó ' || coalesce(quien,'otra persona') ||
               coalesce(' a las ' || cuando, ''));
  end;
  return (jsonb_build_object('ok', true) || fn_mi_dia(p_dni, p_token)::jsonb)::json;
end $function$;

CREATE OR REPLACE FUNCTION public.fn_reclamar_lote(p_dni text, p_token uuid, p_area text, p_tickets jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o operarios; t jsonb; n int := 0; conflictos text[] := '{}';
begin
  o := _auth(p_dni, p_token);
  if jsonb_typeof(p_tickets) <> 'array' or jsonb_array_length(p_tickets) = 0 then
    return json_build_object('ok', false, 'error', 'Lote vacío');
  end if;
  if jsonb_array_length(p_tickets) > 60 then
    return json_build_object('ok', false, 'error', 'Máximo 60 paquetes por lote');
  end if;
  for t in select * from jsonb_array_elements(p_tickets) loop
    begin
      if _modulo_cerrado(p_area, t->>'of', t->>'modulo') then
        conflictos := conflictos || ('Módulo cerrado: ' || coalesce(t->>'num', t->>'codigo'));
        continue;
      end if;
      insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant,
                            numeracion, articulo, color, talla, corte, nop)
      values (t->>'codigo', o.dni, p_area, t->>'of', t->>'modulo', t->>'op',
              coalesce((t->>'std')::numeric,0), coalesce((t->>'cant')::numeric,0),
              t->>'num', t->>'articulo', t->>'color', t->>'talla', t->>'corte',
              nullif(t->>'nop','')::int);
      n := n + 1;
    exception when unique_violation then
      conflictos := conflictos || coalesce(t->>'num', t->>'codigo');
    end;
  end loop;
  return (jsonb_build_object('ok', true, 'reclamados', n,
          'conflictos', to_jsonb(conflictos)) || fn_mi_dia(p_dni, p_token)::jsonb)::json;
end $function$;

commit;
