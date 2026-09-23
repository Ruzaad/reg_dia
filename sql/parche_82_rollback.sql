-- Vuelta atrás del PARCHE 82: fn_login tal como estaba en producción el 23-set-2026.
-- fn_personal_crear / fn_personal_resetear_pin NO se revierten: la versión
-- anterior guardaba el PIN en texto plano y dejaba a la persona sin poder entrar.

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
