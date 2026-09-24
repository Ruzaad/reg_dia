-- PARCHE 86 — Ingeniería · HISTORIAL DE TIEMPOS DE BASE (solo ALOPEZ)
-- Cada cambio de tiempo STD en `bases` queda anotado con fecha, usuario,
-- artículo, módulo y operación: tiempo editado, operación agregada u
-- operación borrada. Solo registra desde que se aplica este parche.
--
-- Quién hizo el cambio: las dos validaciones de Ingeniería (_ing y
-- fn_validar_ingenieria), por las que pasan todas las funciones que escriben
-- en bases, dejan el usuario en `app.dni` solo para esa transacción, y el
-- trigger lo lee de ahí. Así no hay que tocar ninguna de las 8 funciones de
-- Base. Si algo escribe en bases por fuera de la app, queda como 'SISTEMA'.
--
-- La lectura (fn_bases_log) valida con _admin: solo el maestro.

create table if not exists public.bases_log (
  id          bigserial primary key,
  creado      timestamptz not null default now(),
  dni         text not null,
  accion      text not null check (accion in ('EDITADO','AGREGADA','BORRADA')),
  area        text,
  articulo    text,
  modulo      text,
  n_op        int,
  operacion   text,
  std_antes   numeric,
  std_despues numeric
);
create index if not exists bases_log_creado_idx on public.bases_log (creado);
alter table public.bases_log enable row level security;
revoke all on public.bases_log from anon, authenticated;

create or replace function public._bases_log_trg()
 returns trigger language plpgsql security definer
 set search_path to 'public'
as $function$
declare v_dni text := coalesce(nullif(current_setting('app.dni', true), ''), 'SISTEMA');
begin
  if tg_op = 'INSERT' then
    insert into bases_log (dni, accion, area, articulo, modulo, n_op, operacion, std_antes, std_despues)
    values (v_dni, 'AGREGADA', new.area, new.articulo, new.modulo, new.n_op, new.operacion, null, new.std);
  elsif tg_op = 'DELETE' then
    insert into bases_log (dni, accion, area, articulo, modulo, n_op, operacion, std_antes, std_despues)
    values (v_dni, 'BORRADA', old.area, old.articulo, old.modulo, old.n_op, old.operacion, old.std, null);
  elsif new.std is distinct from old.std then
    insert into bases_log (dni, accion, area, articulo, modulo, n_op, operacion, std_antes, std_despues)
    values (v_dni, 'EDITADO', new.area, new.articulo, new.modulo, new.n_op, new.operacion, old.std, new.std);
  end if;
  return null;
end $function$;

revoke execute on function public._bases_log_trg() from public, anon, authenticated;

drop trigger if exists bases_log_trg on public.bases;
create trigger bases_log_trg
  after insert or delete or update of std on public.bases
  for each row execute function public._bases_log_trg();

-- Las dos validaciones de Ingeniería: igual que antes más una línea que deja
-- el usuario para el trigger.
create or replace function public._ing(p_dni text, p_token uuid)
 returns operarios language plpgsql security definer
 set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  if o.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  perform set_config('app.dni', o.dni, true);
  return o;
end $function$;

create or replace function public.fn_validar_ingenieria(p_dni text, p_token text)
 returns void language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v operarios%rowtype;
begin
  select * into v from operarios where dni = p_dni;
  if not found or v.token::text is distinct from p_token or v.token_expira < now() then
    raise exception 'SESION_INVALIDA';
  end if;
  if v.cargo <> 'INGENIERIA' then
    raise exception 'NO_AUTORIZADA';
  end if;
  perform set_config('app.dni', v.dni, true);
end;
$function$;

create or replace function public.fn_bases_log(
  p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text default '')
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '30s'
as $function$
declare v json;
begin
  perform _admin(p_dni, p_token);
  if p_hasta < p_desde then
    return json_build_object('ok', false, 'error', 'La fecha final no puede ser menor a la inicial');
  end if;
  if (p_hasta - p_desde) > 185 then
    return json_build_object('ok', false, 'error', 'Rango máximo 6 meses');
  end if;

  select coalesce(json_agg(json_build_object(
           'fecha', to_char(l.creado at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'),
           'dni', l.dni, 'nombre', o.nombres_apellidos, 'accion', l.accion,
           'area', l.area, 'articulo', l.articulo, 'modulo', l.modulo,
           'n_op', l.n_op, 'operacion', l.operacion,
           'std_antes', l.std_antes, 'std_despues', l.std_despues)
           order by l.creado desc, l.id desc), '[]'::json)
    into v
    from bases_log l
    left join operarios o on o.dni = l.dni
   where l.creado >= (p_desde::timestamp at time zone 'America/Lima')
     and l.creado <  ((p_hasta + 1)::timestamp at time zone 'America/Lima')
     and (coalesce(p_area, '') = '' or l.area = p_area);

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
