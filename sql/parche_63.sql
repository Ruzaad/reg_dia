-- PARCHE 63 — Seguridad del login
-- 1) PIN en texto plano -> hash bcrypt (pgcrypto, ya estaba instalado).
-- 2) fn_login: límite de intentos (5 fallos -> bloqueo 15 min).
-- 3) search_path fijo en las funciones SECURITY DEFINER que no lo tenían
--    (evita secuestro de esquema).
-- 4) Revoca EXECUTE de anon/authenticated en funciones internas (prefijo "_")
--    que no deberían llamarse directo desde fuera de otras funciones.

alter table operarios
  add column if not exists login_fallos integer not null default 0,
  add column if not exists login_bloqueado_hasta timestamptz;

-- Hash de los PIN existentes (una sola vez; el guard evita doble-hasheo si
-- este patch se corre más de una vez).
update operarios
   set pin = crypt(pin, gen_salt('bf'))
 where pin !~ '^\$2[aby]\$';

-- pgcrypto (crypt/gen_salt) vive en el esquema "extensions" en Supabase,
-- no en "public" — por eso search_path necesita los dos, sin comillas
-- envolviendo la lista completa (si no, Postgres lo toma como un solo
-- nombre de esquema literal "public, extensions" y la función se rompe).
create or replace function public.fn_login(p_dni text, p_pin text)
 returns json
 language plpgsql
 security definer
 set search_path to public, extensions
as $function$
declare o operarios; t uuid;
begin
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
    token = t, token_expira = now() + interval '4 hours',
    login_fallos = 0, login_bloqueado_hasta = null
   where dni = o.dni;
  return json_build_object('ok', true, 'dni', o.dni,
    'nombre', o.nombres_apellidos, 'cargo', o.cargo,
    'area_actual', o.area_actual, 'token', t);
end $function$;

create or replace function public.fn_cambiar_pin(p_dni text, p_token uuid, p_pin_actual text, p_pin_nuevo text)
 returns json
 language plpgsql
 security definer
 set search_path to public, extensions
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  if o.pin is null or crypt(p_pin_actual, o.pin) <> o.pin then
    return json_build_object('ok', false, 'error', 'El PIN actual no coincide');
  end if;
  if p_pin_nuevo !~ '^[0-9]{4}$' then
    return json_build_object('ok', false, 'error', 'El nuevo PIN debe tener 4 dígitos');
  end if;
  if crypt(p_pin_nuevo, o.pin) = o.pin then
    return json_build_object('ok', false, 'error', 'El nuevo PIN no puede ser igual al actual');
  end if;
  update operarios set pin = crypt(p_pin_nuevo, gen_salt('bf')) where dni = o.dni;
  return json_build_object('ok', true);
exception
  when others then
    if SQLERRM like '%SESION_INVALIDA%' then raise; end if;
    return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- search_path fijo (sin cambiar lógica) en el resto de funciones que el
-- linter marcó como "search_path mutable".
alter function public._auth(text, uuid) set search_path to 'public';
alter function public._ing(text, uuid) set search_path to 'public';
alter function public.fn_asistencia_dia(text, uuid, date) set search_path to 'public';
alter function public.fn_bases_existentes(text, uuid, text, text[]) set search_path to 'public';
alter function public.fn_bases_listar(text, uuid, text) set search_path to 'public';
alter function public.fn_mi_dia(text, uuid) set search_path to 'public';
alter function public.fn_reclamados(text, uuid, text) set search_path to 'public';
alter function public.fn_reclamar_lote(text, uuid, text, jsonb) set search_path to 'public';
alter function public.fn_tickets_dia(text, uuid, date) set search_path to 'public';

-- Funciones internas (prefijo "_"): las siguen llamando otras funciones
-- fn_* (mismo dueño, así que el REVOKE no las afecta), pero no deben quedar
-- invocables directo vía /rest/v1/rpc/_algo con la anon key pública.
revoke execute on function public._ausente(text) from public, anon, authenticated;
revoke execute on function public._ausente_en(text, date) from public, anon, authenticated;
revoke execute on function public._auth(text, uuid) from public, anon, authenticated;
revoke execute on function public._base_resecuenciar(text, text, bigint) from public, anon, authenticated;
revoke execute on function public._deshacer_troceo(text, text, text) from public, anon, authenticated;
revoke execute on function public._disp_dia_areas(date) from public, anon, authenticated;
revoke execute on function public._disp_prorrateado(text, text, date) from public, anon, authenticated;
revoke execute on function public._estado_dia(text, date) from public, anon, authenticated;
revoke execute on function public._hoy() from public, anon, authenticated;
revoke execute on function public._ing(text, uuid) from public, anon, authenticated;
revoke execute on function public._int(text) from public, anon, authenticated;
revoke execute on function public._min_salida(time, time, boolean) from public, anon, authenticated;
revoke execute on function public._modulo_cerrado(text, text, text) from public, anon, authenticated;
revoke execute on function public._nk(text) from public, anon, authenticated;
revoke execute on function public._paq_cant(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public._paq_div_n(text, text, integer) from public, anon, authenticated;
revoke execute on function public._propagar_std_articulos(text, text[]) from public, anon, authenticated;
revoke execute on function public._reclamo_mueve_area() from public, anon, authenticated;
revoke execute on function public._reclamo_op_id() from public, anon, authenticated;
revoke execute on function public._ruta(text, text) from public, anon, authenticated;
revoke execute on function public._sync_reclamos_articulo(text, text) from public, anon, authenticated;
revoke execute on function public._tipo_ajuste(text) from public, anon, authenticated;
