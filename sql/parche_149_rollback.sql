begin;
drop function if exists public.fn_inicio_mes(text, uuid, date);
drop function if exists public.fn_inicio_resumen(text, uuid, date);
drop table if exists public.inicio_mes_cache;

create or replace function public.fn_login(p_dni text, p_pin text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare o operarios; t uuid; v_fallos int; v_ok boolean; v_min int;
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
    v_min := ceil(extract(epoch from o.login_bloqueado_hasta - now()) / 60);
    return json_build_object('ok', false, 'intentos_restantes', 0,
      'error', 'Cuenta bloqueada por 5 intentos fallidos. Intenta en ' || v_min || ' min o pide a ingeniería que resetee tu PIN.');
  end if;

  -- Bloqueo vencido: el contador vuelve a cero.
  v_fallos := case when o.login_bloqueado_hasta is not null then 0 else coalesce(o.login_fallos, 0) end;

  if o.pin ~ '^\$2[aby]\$' then
    v_ok := crypt(p_pin, o.pin) = o.pin;
  else
    v_ok := o.pin is not null and o.pin = p_pin;   -- PIN heredado en texto plano
  end if;

  if not v_ok then
    v_fallos := v_fallos + 1;
    update operarios set
      login_fallos = v_fallos,
      login_bloqueado_hasta = case when v_fallos >= 5 then now() + interval '15 minutes' end
    where dni = o.dni;
    if v_fallos >= 5 then
      return json_build_object('ok', false, 'intentos_restantes', 0,
        'error', 'Clave incorrecta. Cuenta bloqueada 15 min. Ingeniería puede resetear tu PIN.');
    end if;
    return json_build_object('ok', false, 'intentos_restantes', 5 - v_fallos,
      'error', 'Clave incorrecta. Te quedan ' || (5 - v_fallos) || ' intento(s).');
  end if;

  t := gen_random_uuid();
  update operarios set
    token = t, token_creado = now(), token_expira = now() + interval '4 hours',
    login_fallos = 0, login_bloqueado_hasta = null,
    pin = case when o.pin ~ '^\$2[aby]\$' then pin else crypt(p_pin, gen_salt('bf')) end
   where dni = o.dni;
  return json_build_object('ok', true, 'dni', o.dni,
    'nombre', o.nombres_apellidos, 'cargo', o.cargo,
    'area_actual', o.area_actual, 'token', t,
    'es_admin', coalesce(o.es_admin, false));
end $function$;
commit;
