-- Vuelta atrás del PARCHE 82: fn_login y fn_personal_editar tal como estaban en
-- producción el 23-set-2026, y quita el rastro de cambios.
-- fn_personal_crear / fn_personal_resetear_pin NO se revierten: la versión
-- anterior guardaba el PIN en texto plano y dejaba a la persona sin poder entrar.

drop trigger if exists operarios_cambios_trg on public.operarios;
drop function if exists public._operarios_cambios_log();
drop table if exists public.operarios_cambios;

create or replace function public.fn_login(p_dni text, p_pin text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare o operarios; t uuid;
begin
  if not fn_horario_ok() then
    return json_build_object('ok', false,
      'error', 'El sistema está fuera de horario. Vuelve dentro del horario de trabajo.');
  end if;

  select * into o from operarios where dni = p_dni and estado = 'ACTIVO';
  if not found then
    return json_build_object('ok', false, 'error', 'DNI o clave incorrectos');
  end if;

  if o.login_bloqueado_hasta is not null and o.login_bloqueado_hasta > now() then
    return json_build_object('ok', false,
      'error', 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta en unos minutos.');
  end if;

  if o.pin is null or crypt(p_pin, o.pin) <> o.pin then
    update operarios set
      login_fallos = login_fallos + 1,
      login_bloqueado_hasta = case when login_fallos + 1 >= 5
                                    then now() + interval '15 minutes'
                                    else login_bloqueado_hasta end
    where dni = o.dni;
    return json_build_object('ok', false, 'error', 'DNI o clave incorrectos');
  end if;

  t := gen_random_uuid();
  update operarios set
    token = t, token_creado = now(), token_expira = now() + interval '4 hours',
    login_fallos = 0, login_bloqueado_hasta = null
   where dni = o.dni;
  return json_build_object('ok', true, 'dni', o.dni,
    'nombre', o.nombres_apellidos, 'cargo', o.cargo,
    'area_actual', o.area_actual, 'token', t,
    'es_admin', coalesce(o.es_admin, false));
end $function$;

create or replace function public.fn_personal_editar(p_dni_ing text, p_token text, p_dni text, p_nombres text, p_area_origen text, p_area_actual text, p_estado text, p_cargo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);

  update operarios set
    nombres_apellidos = p_nombres,
    area_origen = p_area_origen,
    area_actual = p_area_actual,
    estado = p_estado,
    cargo = p_cargo
  where dni = p_dni;

  if not found then
    return json_build_object('ok', false, 'error', 'No existe ese DNI');
  end if;

  return json_build_object('ok', true);
exception
  when others then
    if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
    return json_build_object('ok', false, 'error', SQLERRM);
end;
$function$;

create or replace function public.fn_personal_editar(p_dni_ing text, p_token text, p_dni text, p_nombres text, p_area_origen text, p_area_actual text, p_estado text, p_cargo text, p_categoria text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cat text;
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);
  v_cat := nullif(upper(trim(coalesce(p_categoria,''))), '');
  if v_cat is not null and v_cat not in ('A','B','C','D') then
    return json_build_object('ok', false, 'error', 'Categoría inválida: usa A, B, C o D');
  end if;
  update operarios set
    nombres_apellidos = p_nombres,
    area_origen = p_area_origen,
    area_actual = p_area_actual,
    estado = p_estado,
    cargo = p_cargo,
    categoria = v_cat
  where dni = p_dni;
  if not found then
    return json_build_object('ok', false, 'error', 'No existe ese DNI');
  end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
