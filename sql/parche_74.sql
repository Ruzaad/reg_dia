-- PARCHE 74 — Sesión deslizante + horario de operación
-- 1) La sesión ya no muere a las 4h del login: muere a las 4h SIN USO.
--    Cada llamada autenticada la renueva, con tope duro de 18h desde el login.
-- 2) Horario de operación (America/Lima), apagado por defecto: cuando se
--    enciende, fuera de la ventana no se puede loguear ni operar.

-- ---------- 1) SESIÓN DESLIZANTE ----------

alter table operarios
  add column if not exists token_creado timestamptz;

-- A las sesiones vivas de ahora se les toma como inicio el login implícito
-- (expira - 4h), para que el tope de 18h no las mate de golpe.
update operarios
   set token_creado = token_expira - interval '4 hours'
 where token is not null and token_creado is null;

-- ---------- 2) HORARIO DE OPERACIÓN ----------

create table if not exists sistema_config (
  clave text primary key,
  valor text not null,
  nota  text
);

insert into sistema_config(clave, valor, nota) values
  ('horario_activo','false','true = fuera de horario se bloquea el sistema'),
  ('horario_desde','07:00','hora Lima de apertura'),
  ('horario_hasta','22:00','hora Lima de cierre')
on conflict (clave) do nothing;

alter table sistema_config enable row level security;
revoke all on table sistema_config from anon, authenticated;

create or replace function public.fn_horario_ok()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select case
    when coalesce((select valor from sistema_config where clave='horario_activo'),'false') <> 'true'
      then true
    else (now() at time zone 'America/Lima')::time
         between coalesce((select valor from sistema_config where clave='horario_desde'),'07:00')::time
             and coalesce((select valor from sistema_config where clave='horario_hasta'),'22:00')::time
  end;
$function$;

revoke execute on function public.fn_horario_ok() from public, anon, authenticated;

-- ---------- _auth: renueva y valida horario ----------

create or replace function public._auth(p_dni text, p_token uuid)
 returns operarios
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  o operarios;
  v_idle  interval := interval '4 hours';   -- inactividad tolerada
  v_max   interval := interval '18 hours';  -- tope duro desde el login
  v_nuevo timestamptz;
begin
  select * into o from operarios
   where dni = p_dni and token = p_token
     and token_expira > now() and estado = 'ACTIVO';
  if not found then raise exception 'SESION_INVALIDA'; end if;

  if not fn_horario_ok() then raise exception 'FUERA_DE_HORARIO'; end if;

  -- Ventana deslizante. Se escribe solo cuando queda menos de media ventana,
  -- así una pantalla que dispara 6 RPC a la vez hace como mucho un UPDATE.
  v_nuevo := least(now() + v_idle, coalesce(o.token_creado, now()) + v_max);
  if o.token_expira < now() + (v_idle / 2) and v_nuevo > o.token_expira then
    update operarios set token_expira = v_nuevo where dni = o.dni;
    o.token_expira := v_nuevo;
  end if;

  return o;
end $function$;

alter function public._auth(text, uuid) set search_path to 'public';
revoke execute on function public._auth(text, uuid) from public, anon, authenticated;

-- ---------- fn_login: marca el inicio y respeta el horario ----------

create or replace function public.fn_login(p_dni text, p_pin text)
 returns json
 language plpgsql
 security definer
 set search_path to public, extensions
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
    'area_actual', o.area_actual, 'token', t);
end $function$;

-- Para ENCENDER el horario (7:00–22:00 Lima):
--   update sistema_config set valor='true' where clave='horario_activo';
-- Para apagarlo:
--   update sistema_config set valor='false' where clave='horario_activo';
