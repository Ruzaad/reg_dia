-- Deshacer parche 140: vuelve a exigir motivo a TARDANZA.
begin;

create or replace function public.fn_solicitud_ocurrencia_crear(p_dni text, p_token uuid, p_area text, p_tipo text, p_minutos integer, p_detalle text, p_dnis text[], p_fecha date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s operarios; d text; n int := 0; v_est text; v_omit text[] := '{}';
        v_fecha date;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'SUPERVISORA' then raise exception 'NO_AUTORIZADA'; end if;
  if p_area <> s.area_actual then raise exception 'NO_AUTORIZADA'; end if;
  if p_minutos = 0 then
    return json_build_object('ok', false, 'error', 'Minutos no puede ser 0');
  end if;
  if p_tipo in ('TARDANZA','SEGURO','PERMISO') and coalesce(trim(p_detalle),'') = '' then
    return json_build_object('ok', false, 'error', 'Indica el motivo (hora de salida/regreso)');
  end if;
  if p_dnis is null or array_length(p_dnis,1) is null then
    return json_build_object('ok', false, 'error', 'Selecciona al menos una persona');
  end if;

  v_fecha := coalesce(p_fecha, _hoy());
  if v_fecha > _hoy() then
    return json_build_object('ok', false, 'error', 'La fecha no puede ser futura');
  end if;
  if v_fecha < (_hoy() - 60) then
    return json_build_object('ok', false, 'error', 'La fecha es de hace más de 60 días');
  end if;

  foreach d in array p_dnis loop
    if not exists (select 1 from operarios where dni = d and area_actual = s.area_actual) then
      continue;
    end if;
    v_est := _ausente_en(d, v_fecha);
    if v_est is not null then
      v_omit := v_omit || (coalesce((select nombres_apellidos from operarios where dni = d), d)
                           || ' ('||v_est||')');
      continue;
    end if;
    insert into solicitudes_ajuste(dni, area, minutos, motivo, tipo,
                                   solicitante_dni, solo_ingenieria, fecha)
    values (d, p_area, p_minutos, coalesce(nullif(trim(p_detalle),''), p_tipo), p_tipo,
            s.dni, true, v_fecha);
    n := n + 1;
  end loop;

  if n = 0 then
    return json_build_object('ok', false, 'omitidos', to_json(v_omit),
      'error', 'Nadie de la selección estuvo ACTIVO el '||to_char(v_fecha,'YYYY-MM-DD')
             ||'. No se solicitó nada.');
  end if;
  return json_build_object('ok', true, 'solicitadas', n,
    'fecha', to_char(v_fecha,'YYYY-MM-DD'),
    'omitidos', to_json(v_omit), 'omitidos_n', coalesce(array_length(v_omit,1),0));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
