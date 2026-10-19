-- PARCHE 135 — Horas extra de la supervisora: elegir la fecha, y horas de fin de semana / feriado
-- fn_sup_he_lista (misma firma): suma el campo 'jornada' (_jornada de ese día; 0 = sábado, domingo o feriado
--   no laborable). No cambia nada más de lo que ya devolvía.
-- fn_sup_horas_fecha (nueva): la supervisora registra a su personal en cualquier día de los últimos 15
--   (hasta hoy). Día laborable: hora extra, hasta 4 h por persona y día (como fn_sup_horas_extra).
--   Día no laborable (_jornada = 0): horas trabajadas de 0.5 a 12 h, guardadas igual que las de Ingeniería
--   (HORA_EXTRA con detalle 'JORNADA SABADO/DOMINGO/FERIADO'); volver a registrar reemplaza lo anterior.
-- fn_sup_horas_extra (solo hoy o ayer) queda igual para los despliegues viejos.
begin;

create or replace function public.fn_sup_he_lista(p_dni text, p_token uuid, p_area text, p_fecha date)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '15s'
as $function$
declare s operarios; v_area text; v_items json; v_ult date; v_ult_min numeric; v_ult_dnis json;
begin
  s := _auth(p_dni, p_token);
  if s.cargo = 'SUPERVISORA' then v_area := s.area_actual;
  elsif s.cargo = 'INGENIERIA' then perform _lector(p_dni, p_token, p_area); v_area := p_area;
  else raise exception 'NO_AUTORIZADA'; end if;
  if p_fecha is null then return json_build_object('ok', false, 'error', 'Elige el día'); end if;

  select coalesce(json_agg(json_build_object(
           'dni', x.dni, 'nombre', x.nombre,
           'estado', coalesce(x.est, 'ACTIVO'),
           'ausente', coalesce(_ausente(x.est), false),
           'he_min', x.he_min, 'tickets', x.tk) order by x.nombre), '[]'::json)
    into v_items
    from (select o.dni, o.nombres_apellidos nombre, _estado_dia(o.dni, p_fecha) est,
                 coalesce((select sum(oc.minutos) from ocurrencias oc
                            where oc.dni = o.dni and oc.fecha = p_fecha and oc.tipo = 'HORA_EXTRA'), 0) he_min,
                 (select count(*) from reclamos r
                   where r.dni = o.dni and r.fecha = p_fecha and r.estado = 'ACTIVO') tk
            from operarios o
           where o.area_origen = v_area and o.estado = 'ACTIVO' and o.cargo = 'OPERARIO') x;

  -- Última vez que hubo horas extra en el área antes de ese día.
  select max(oc.fecha) into v_ult
    from ocurrencias oc join operarios o on o.dni = oc.dni
   where oc.tipo = 'HORA_EXTRA' and oc.fecha < p_fecha and oc.fecha >= p_fecha - 60
     and o.area_origen = v_area;
  if v_ult is not null then
    select json_agg(distinct oc.dni), max(oc.minutos) into v_ult_dnis, v_ult_min
      from ocurrencias oc join operarios o on o.dni = oc.dni
     where oc.tipo = 'HORA_EXTRA' and oc.fecha = v_ult and o.area_origen = v_area;
  end if;

  return json_build_object('ok', true, 'area', v_area, 'fecha', to_char(p_fecha,'YYYY-MM-DD'),
    'hoy', to_char(_hoy(),'YYYY-MM-DD'), 'jornada', _jornada(p_fecha), 'items', v_items,
    'ultima', case when v_ult is null then null else json_build_object(
      'fecha', to_char(v_ult,'YYYY-MM-DD'), 'minutos', v_ult_min, 'dnis', v_ult_dnis) end);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_sup_horas_fecha(p_dni text, p_token uuid, p_fecha date, p_minutos numeric, p_dnis text[])
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s operarios; d text; n int := 0; v_ya numeric; v_est text; v_nolab boolean; v_det text;
        v_omit text[] := '{}'; v_nom text;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'SUPERVISORA' then raise exception 'NO_AUTORIZADA'; end if;
  if p_fecha is null or p_fecha > _hoy() or p_fecha < _hoy() - 15 then
    return json_build_object('ok', false, 'error', 'Solo se pueden registrar los últimos 15 días, hasta hoy');
  end if;
  v_nolab := _jornada(p_fecha) = 0;
  if v_nolab then
    if p_minutos is null or p_minutos < 30 or p_minutos > 720 then
      return json_build_object('ok', false, 'error', 'Las horas trabajadas van de 0.5 a 12 h por persona');
    end if;
    v_det := 'JORNADA ' || case when _feriado(p_fecha) then 'FERIADO'
                                when extract(isodow from p_fecha) = 6 then 'SABADO' else 'DOMINGO' end;
  elsif p_minutos is null or p_minutos < 30 or p_minutos > 240 then
    return json_build_object('ok', false, 'error', 'Las horas extra van de 0.5 a 4 h por persona');
  end if;
  if coalesce(array_length(p_dnis,1),0) = 0 then
    return json_build_object('ok', false, 'error', 'Marca al menos a una persona');
  end if;
  perform pg_advisory_xact_lock(hashtext('fn_sup_horas_fecha:' || s.dni));

  foreach d in array (select array_agg(distinct x) from unnest(p_dnis) x) loop
    select nombres_apellidos into v_nom from operarios
     where dni = d and area_origen = s.area_actual and estado = 'ACTIVO' and cargo = 'OPERARIO';
    if v_nom is null then
      v_omit := v_omit || (d || ' (no es de tu área)'); continue;
    end if;
    v_est := _ausente_en(d, p_fecha);
    if v_est is not null then
      v_omit := v_omit || (v_nom || ' (' || v_est || ')'); continue;
    end if;
    if v_nolab then
      delete from ocurrencias where dni = d and fecha = p_fecha and tipo = 'HORA_EXTRA' and detalle like 'JORNADA %';
      insert into ocurrencias (dni, area, tipo, minutos, detalle, supervisora_dni, fecha)
      values (d, s.area_actual, 'HORA_EXTRA', p_minutos, v_det, s.dni, p_fecha);
    else
      select coalesce(sum(minutos),0) into v_ya from ocurrencias
       where dni = d and fecha = p_fecha and tipo = 'HORA_EXTRA';
      if v_ya + p_minutos > 240 then
        v_omit := v_omit || (v_nom || ' (ya tiene ' || trim(to_char(v_ya/60.0,'FM990.0')) || ' h; el tope es 4 h)'); continue;
      end if;
      insert into ocurrencias (dni, area, tipo, minutos, detalle, supervisora_dni, fecha)
      values (d, s.area_actual, 'HORA_EXTRA', p_minutos, 'Registrada por la supervisora', s.dni, p_fecha);
    end if;
    n := n + 1;
  end loop;

  if n = 0 then
    return json_build_object('ok', false, 'omitidos', to_json(v_omit),
      'error', 'No se registró a nadie: ' || array_to_string(v_omit, ', '));
  end if;
  return json_build_object('ok', true, 'afectados', n, 'omitidos', to_json(v_omit), 'no_laborable', v_nolab);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_sup_he_lista(text, uuid, text, date) to anon, authenticated;
grant execute on function public.fn_sup_horas_fecha(text, uuid, date, numeric, text[]) to anon, authenticated;

commit;
