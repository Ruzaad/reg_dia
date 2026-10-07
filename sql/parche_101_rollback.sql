-- VUELTA ATRÁS DEL PARCHE 101
-- Deja Auditoría, Incentivos e Historial de tiempos otra vez solo para el
-- administrador (_admin) y corregir o eliminar incidencias otra vez con _ing.
-- La tabla correcciones_log se conserva con lo que ya registró; solo se quitan
-- sus triggers. Para borrarla: drop table public.correcciones_log;
begin;

-- RPC de lectura: se devuelve la primera línea a _admin.
do $$
declare f record; d text;
begin
  for f in select * from (values
    ('fn_ef_auditoria',             'perform _vista(p_dni, p_token, array[''pasoAudit''], coalesce(p_area, ''''));'),
    ('fn_ef_auditoria_v2',          'perform _vista(p_dni, p_token, array[''pasoAudit''], coalesce(p_area, ''''));'),
    ('fn_ef_auditoria_detalle',     'perform _vista_area(_vista(p_dni, p_token, array[''pasoAudit''], null), (select array[x.area_origen, x.area_actual] from operarios x where x.dni = p_dni_op), false);'),
    ('fn_ef_auditoria_ops',         'perform _vista_area(_vista(p_dni, p_token, array[''pasoAudit''], null), (select array[x.area_origen, x.area_actual] from operarios x where x.dni = p_dni_op), false);'),
    ('fn_incentivos_quincena',      'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_incentivos_tabla_listar',  'perform _vista(p_dni, p_token, array[''pasoInc''], null);'),
    ('fn_bono_modular_tabla_listar','perform _vista(p_dni, p_token, array[''pasoInc''], null);'),
    ('fn_bono_modular_listar',      'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_ef_manual_listar',         'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_ef_tickets_rango',         'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_consideracion_listar',     'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_bases_log',                'perform _vista(p_dni, p_token, array[''pasoBaseLog''], coalesce(p_area, ''''));')
  ) z(nombre, linea) loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f.nombre;
    if d is null or position(f.linea in d) = 0 then continue; end if;
    execute replace(d, f.linea, 'perform _admin(p_dni, p_token);');
  end loop;
end $$;

-- RPC que escriben: como estaban antes del parche 101.
CREATE OR REPLACE FUNCTION public.fn_bono_modular_guardar(p_dni text, p_token uuid, p_cambios jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s operarios; c jsonb; v_area text; v_fecha date; v_pct numeric;
        n_up int := 0; n_del int := 0;
begin
  s := _admin(p_dni, p_token);
  for c in select value from jsonb_array_elements(coalesce(p_cambios,'[]'::jsonb)) loop
    v_area  := nullif(trim(coalesce(c->>'area','')), '');
    v_fecha := (c->>'fecha')::date;
    if v_area is null or v_fecha is null then continue; end if;
    v_pct := nullif(trim(coalesce(c->>'pct','')), '')::numeric;
    if v_pct is null then
      delete from bono_modular_dia where area = v_area and fecha = v_fecha;
      n_del := n_del + 1;
    else
      insert into bono_modular_dia (area, fecha, pct, registrado_por)
      values (v_area, v_fecha, v_pct, s.dni)
      on conflict (area, fecha) do update
        set pct = excluded.pct, registrado_por = excluded.registrado_por, creado = now();
      n_up := n_up + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'guardados', n_up, 'borrados', n_del);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_bono_modular_override(p_dni text, p_token uuid, p_dni_op text, p_desde date, p_hasta date, p_forzar boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s operarios;
begin
  s := _admin(p_dni, p_token);
  if coalesce(trim(p_dni_op),'') = '' or p_desde is null or p_hasta is null then
    return json_build_object('ok', false, 'error', 'Faltan persona o rango');
  end if;
  if p_forzar is null then
    delete from bono_modular_override
     where dni = trim(p_dni_op) and desde = p_desde and hasta = p_hasta;
    return json_build_object('ok', true, 'forzar', null);
  end if;
  insert into bono_modular_override (dni, desde, hasta, forzar, registrado_por)
  values (trim(p_dni_op), p_desde, p_hasta, p_forzar, s.dni)
  on conflict (dni, desde, hasta) do update
    set forzar = excluded.forzar, registrado_por = excluded.registrado_por, creado = now();
  return json_build_object('ok', true, 'forzar', p_forzar);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_ef_manual_guardar(p_dni text, p_token uuid, p_cambios jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s operarios; c jsonb; v_d text; v_f date; v_pct numeric;
        n_up int := 0; n_del int := 0;
begin
  s := _admin(p_dni, p_token);
  for c in select value from jsonb_array_elements(coalesce(p_cambios,'[]'::jsonb)) loop
    v_d := nullif(trim(coalesce(c->>'dni','')), '');
    v_f := (c->>'fecha')::date;
    if v_d is null or v_f is null then continue; end if;
    v_pct := nullif(trim(coalesce(c->>'pct','')), '')::numeric;
    if v_pct is null then
      delete from eficiencia_manual where dni = v_d and fecha = v_f;
      n_del := n_del + 1;
    else
      insert into eficiencia_manual (dni, fecha, pct, registrado_por)
      values (v_d, v_f, v_pct, s.dni)
      on conflict (dni, fecha) do update
        set pct = excluded.pct, registrado_por = excluded.registrado_por, creado = now();
      n_up := n_up + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'guardados', n_up, 'borrados', n_del);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_consideracion_guardar(p_dni text, p_token uuid, p_id bigint, p_dni_op text, p_fecha date, p_minutos numeric, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s operarios; v_id bigint;
begin
  s := _admin(p_dni, p_token);
  if coalesce(trim(p_dni_op),'') = '' or p_fecha is null then
    return json_build_object('ok', false, 'error', 'Persona y fecha son obligatorias');
  end if;
  if coalesce(p_minutos,0) = 0 then
    return json_build_object('ok', false, 'error', 'Los minutos no pueden ser cero');
  end if;
  if not exists (select 1 from operarios where dni = p_dni_op) then
    return json_build_object('ok', false, 'error', 'No existe esa persona');
  end if;
  if p_id is null then
    insert into minutos_consideracion (dni, fecha, minutos, motivo, registrado_por)
    values (trim(p_dni_op), p_fecha, p_minutos, nullif(trim(coalesce(p_motivo,'')),''), s.dni)
    returning id into v_id;
  else
    update minutos_consideracion
       set dni = trim(p_dni_op), fecha = p_fecha, minutos = p_minutos,
           motivo = nullif(trim(coalesce(p_motivo,'')),''), registrado_por = s.dni
     where id = p_id
    returning id into v_id;
    if v_id is null then return json_build_object('ok', false, 'error', 'No existe esa línea'); end if;
  end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_consideracion_eliminar(p_dni text, p_token uuid, p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  perform _admin(p_dni, p_token);
  delete from minutos_consideracion where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', false, 'error', 'No existe esa línea'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_ocurrencia_editar(p_dni text, p_token uuid, p_id bigint, p_dni_op text, p_tipo text, p_minutos numeric, p_fecha date, p_detalle text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- El área solo se recalcula si la incidencia cambia de PERSONA. Editar
  -- minutos, fecha, tipo o detalle deja la incidencia en su área original.
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

CREATE OR REPLACE FUNCTION public.fn_ocurrencia_eliminar(p_dni text, p_token uuid, p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _ing(p_dni, p_token);
  delete from ocurrencias where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'No existe esa incidencia'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Registro de correcciones: fuera los triggers y la función de la pantalla.
drop trigger if exists correccion_log_trg on public.ocurrencias;
drop trigger if exists correccion_log_trg on public.eficiencia_manual;
drop trigger if exists correccion_log_trg on public.minutos_consideracion;
drop trigger if exists correccion_log_trg on public.bono_modular_dia;
drop trigger if exists correccion_log_trg on public.bono_modular_override;
drop function if exists public._correccion_log_trg();
drop function if exists public.fn_correcciones_listar(text, uuid, date, date);
drop function if exists public._vista_area(operarios, text[], boolean);
drop function if exists public._vista(text, uuid, text[], text);

-- Las pestañas que se hayan dado ya no sirven sin el parche.
delete from public.permisos_pestana where pestana in ('pasoAudit','pasoInc','pasoBaseLog');

commit;
