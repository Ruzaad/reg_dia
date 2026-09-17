-- PARCHE 75 — Incidencias que se movían de área al editarlas
-- fn_ocurrencia_editar reescribía `area` con el area_actual de la persona.
-- La lista de incidencias filtra por área: editar minutos o fecha de alguien
-- prestado a otra área movía la fila y "desaparecía" de la vista.
-- El área de una incidencia es la de cuando ocurrió; solo se recalcula si la
-- incidencia cambia de PERSONA.

create or replace function public.fn_ocurrencia_editar(p_dni text, p_token uuid, p_id bigint, p_dni_op text, p_tipo text, p_minutos numeric, p_fecha date, p_detalle text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; v_area text; v_fecha date; v_est text; v_dni_ant text;
begin
  s := _ing(p_dni, p_token);
  if p_minutos = 0 then return json_build_object('ok', false, 'error', 'Minutos no puede ser 0'); end if;
  if p_tipo not in ('MAQUINA','HORA_EXTRA','PAGO_HORA','TARDANZA','SEGURO','PERMISO',
                    'ARREGLOS','MUESTRAS','REPROCESOS','DESCOSER','OTROS') then
    return json_build_object('ok', false, 'error', 'Tipo inválido'); end if;
  if not exists (select 1 from operarios where dni = p_dni_op) then
    return json_build_object('ok', false, 'error', 'No existe ese DNI'); end if;

  select coalesce(p_fecha, fecha), dni into v_fecha, v_dni_ant
    from ocurrencias where id = p_id;
  if v_fecha is null then return json_build_object('ok', false, 'error', 'No existe esa incidencia'); end if;
  v_est := _ausente_en(p_dni_op, v_fecha);
  if v_est is not null then
    return json_build_object('ok', false, 'error',
      'El '||to_char(v_fecha,'YYYY-MM-DD')||' esa persona está como '||v_est
      ||': no puede tener incidencias ese día.');
  end if;

  if p_dni_op is distinct from v_dni_ant then
    select area_actual into v_area from operarios where dni = p_dni_op;
  else
    v_area := null;
  end if;

  update ocurrencias
     set dni = p_dni_op, area = coalesce(v_area, area), tipo = p_tipo,
         minutos = p_minutos, fecha = v_fecha,
         detalle = nullif(trim(p_detalle),'')
   where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'No existe esa incidencia'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- NOTA: las RPC fn_origen_reclamos, fn_area_almacen, fn_tickets_libres y
-- fn_asignar_tickets siguen existiendo en la BD. Este parche solo retira su
-- interfaz en ingeniería; no se borra nada del lado del servidor.
