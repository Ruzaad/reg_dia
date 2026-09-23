-- PARCHE 82 — Personal nuevo sin acceso, intentos restantes y rastro de cambios
--
-- 1) fn_personal_crear (las dos firmas) y fn_personal_resetear_pin guardaban el
--    PIN en TEXTO PLANO ('1234' / '1111'). Desde el parche 63 fn_login compara
--    con bcrypt, así que todo el que se creó o se reseteó desde el 11-set no
--    podía entrar nunca. Ahora guardan el hash y limpian el bloqueo.
-- 2) Los PIN que quedaron en texto plano se hashean (con el guard del 63).
-- 3) fn_login dice cuántos intentos quedan y cuántos minutos falta de bloqueo.
--    Además, cuando el bloqueo ya venció, el contador arranca de cero: antes
--    seguía en 5 y el siguiente fallo volvía a bloquear 15 min de inmediato.
--    Si algún PIN llegara en texto plano, se acepta una vez y se rehashea.
-- 4) operarios_cambios: rastro de cada cambio de cargo, categoría, estado y
--    área origen (quién, desde qué despliegue y cuándo). Solo lo escribe un
--    trigger; nadie de fuera lo lee.

-- 1) ---------------------------------------------------------------------
create or replace function public.fn_personal_crear(p_dni_ing text, p_token text, p_dni text, p_nombres text, p_area_origen text, p_area_actual text, p_estado text, p_cargo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pin text;
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);

  if exists (select 1 from operarios where dni = p_dni) then
    return json_build_object('ok', false, 'error', 'Ya existe un operario con ese DNI');
  end if;

  v_pin := case when p_cargo = 'INGENIERIA' then '1111' else '1234' end;

  insert into operarios (dni, nombres_apellidos, area_origen, area_actual, estado, cargo, pin)
  values (p_dni, p_nombres, p_area_origen, p_area_actual, p_estado, p_cargo,
          extensions.crypt(v_pin, extensions.gen_salt('bf')));

  return json_build_object('ok', true, 'pin_inicial', v_pin);
exception
  when others then
    if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
    return json_build_object('ok', false, 'error', SQLERRM);
end;
$function$;

create or replace function public.fn_personal_crear(p_dni_ing text, p_token text, p_dni text, p_nombres text, p_area_origen text, p_area_actual text, p_estado text, p_cargo text, p_categoria text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_pin text; v_cat text;
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);
  if exists (select 1 from operarios where dni = p_dni) then
    return json_build_object('ok', false, 'error', 'Ya existe un operario con ese DNI');
  end if;
  v_cat := nullif(upper(trim(coalesce(p_categoria,''))), '');
  if v_cat is not null and v_cat not in ('A','B','C','D') then
    return json_build_object('ok', false, 'error', 'Categoría inválida: usa A, B, C o D');
  end if;
  v_pin := case when p_cargo = 'INGENIERIA' then '1111' else '1234' end;
  insert into operarios (dni, nombres_apellidos, area_origen, area_actual, estado, cargo, pin, categoria)
  values (p_dni, p_nombres, p_area_origen, p_area_actual, p_estado, p_cargo,
          extensions.crypt(v_pin, extensions.gen_salt('bf')), v_cat);
  return json_build_object('ok', true, 'pin_inicial', v_pin);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_personal_resetear_pin(p_dni_ing text, p_token text, p_dni text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cargo text;
  v_pin text;
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);

  select cargo into v_cargo from operarios where dni = p_dni;
  if not found then
    return json_build_object('ok', false, 'error', 'No existe ese DNI');
  end if;

  v_pin := case when v_cargo = 'INGENIERIA' then '1111' else '1234' end;

  update operarios
     set pin = extensions.crypt(v_pin, extensions.gen_salt('bf')),
         token = null, token_expira = null,
         login_fallos = 0, login_bloqueado_hasta = null
   where dni = p_dni;

  return json_build_object('ok', true, 'pin_nuevo', v_pin);
exception
  when others then
    if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
    return json_build_object('ok', false, 'error', SQLERRM);
end;
$function$;

-- 2) ---------------------------------------------------------------------
update operarios
   set pin = extensions.crypt(pin, extensions.gen_salt('bf')),
       login_fallos = 0, login_bloqueado_hasta = null
 where pin is not null and pin !~ '^\$2[aby]\$';

-- 3) ---------------------------------------------------------------------
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

-- 4) ---------------------------------------------------------------------
create table if not exists public.operarios_cambios (
  id       bigserial primary key,
  dni      text not null,
  campo    text not null,
  antes    text,
  despues  text,
  por      text,
  origen   text,
  cuando   timestamptz not null default now()
);
create index if not exists operarios_cambios_dni_idx on public.operarios_cambios (dni, cuando desc);
alter table public.operarios_cambios enable row level security;
revoke all on public.operarios_cambios from anon, authenticated;
revoke all on sequence public.operarios_cambios_id_seq from anon, authenticated;

create or replace function public._operarios_cambios_log()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_por text := coalesce(nullif(current_setting('samitex.editor', true), ''), 'sistema');
  v_org text;
begin
  begin
    v_org := coalesce(current_setting('request.headers', true)::json->>'origin',
                      current_setting('request.headers', true)::json->>'referer');
  exception when others then v_org := null;
  end;
  insert into operarios_cambios (dni, campo, antes, despues, por, origen)
  select NEW.dni, c.campo, c.antes, c.despues, v_por, v_org
    from (values ('cargo', OLD.cargo, NEW.cargo),
                 ('categoria', OLD.categoria, NEW.categoria),
                 ('estado', OLD.estado, NEW.estado),
                 ('area_origen', OLD.area_origen, NEW.area_origen)) c(campo, antes, despues)
   where c.antes is distinct from c.despues;
  return NEW;
end $function$;
revoke all on function public._operarios_cambios_log() from public, anon, authenticated;

drop trigger if exists operarios_cambios_trg on public.operarios;
create trigger operarios_cambios_trg
  after update of cargo, categoria, estado, area_origen on public.operarios
  for each row execute function public._operarios_cambios_log();

-- Las dos firmas de fn_personal_editar dejan su huella para el rastro.
-- La vieja (8 parámetros) sigue igual por dentro: la usan despliegues sin migrar.
create or replace function public.fn_personal_editar(p_dni_ing text, p_token text, p_dni text, p_nombres text, p_area_origen text, p_area_actual text, p_estado text, p_cargo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);
  perform set_config('samitex.editor', p_dni_ing || ' (editar v8)', true);

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
  perform set_config('samitex.editor', p_dni_ing || ' (editar)', true);
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

-- Consulta útil cuando alguien diga "se cambió solo":
--   select * from operarios_cambios where dni = '10324831' order by cuando desc;
