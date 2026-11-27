-- PARCHE 200 — Roles configurables (UDP) y PCP solo para Ingeniería
-- 1) PCP: cargar programa/corte/cronograma y guardar metas exige cargo INGENIERIA (o Admin): _pcp_editor.
-- 2) roles_sistema: catálogo de roles propios (nombre + pestañas que abren). Sin áreas ni escritura.
--    Al asignar el rol a alguien (alta o cambio de rol) o al guardar el rol, sus pestañas pasan a permisos_pestana.
--    Las excepciones por persona se siguen ajustando en Permisos.
-- 3) fn_roles_listar / fn_roles_guardar / fn_roles_eliminar. UDP nace con la pestaña PCP (pasoPcp; Cronogramas la sigue).
-- Rollback: parche_200_rollback.sql
begin;

create or replace function public._pcp_editor(p_dni text, p_token uuid)
 returns operarios language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  if not (coalesce(o.es_admin, false)
          or (o.cargo = 'INGENIERIA' and exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR'))) then
    raise exception 'NO_AUTORIZADA: solo Ingeniería puede cargar y editar en PCP';
  end if;
  return o;
end $function$;

create table if not exists public.roles_sistema (
  nombre text primary key check (nombre = upper(nombre) and nombre ~ '^[A-Z][A-Z0-9_ ]{1,29}$'),
  pestanas text[] not null default '{}',
  creado timestamptz not null default now(),
  creado_por text
);
alter table public.roles_sistema enable row level security;
revoke all on public.roles_sistema from anon, authenticated;
insert into public.roles_sistema (nombre, pestanas, creado_por) values ('UDP', array['pasoPcp'], 'parche 200')
  on conflict (nombre) do nothing;

create or replace function public._rol_aplicar(p_dni text, p_cargo text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_p text[];
begin
  select pestanas into v_p from roles_sistema where nombre = p_cargo;
  if not found then return; end if;
  delete from permisos_pestana where dni = p_dni;
  insert into permisos_pestana (dni, pestana, asignado_por)
  select p_dni, x, 'rol ' || p_cargo from unnest(v_p) x;
end $function$;
revoke execute on function public._rol_aplicar(text, text) from public, anon, authenticated;

create or replace function public._rol_trg()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _rol_aplicar(new.dni, new.cargo);
  return null;
end $function$;
drop trigger if exists rol_trg on public.operarios;
create trigger rol_trg after insert or update of cargo on public.operarios
  for each row when (new.cargo is not null and new.cargo not in ('OPERARIO','ESTAJERO','SUPERVISORA'))
  execute function _rol_trg();

create or replace function public.fn_roles_listar(p_dni_ing text, p_token text)
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);
  return json_build_object('ok', true, 'roles', coalesce((
    select json_agg(json_build_object('nombre', r.nombre, 'pestanas', r.pestanas,
             'personas', (select count(*) from operarios o where o.cargo = r.nombre)) order by r.nombre)
      from roles_sistema r), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_roles_guardar(p_dni text, p_token uuid, p_nombre text, p_pestanas text[])
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_n text := upper(trim(coalesce(p_nombre, ''))); v_p text[]; r record; v_c int := 0;
begin
  o := _admin(p_dni, p_token);
  if v_n !~ '^[A-Z][A-Z0-9_ ]{1,29}$' then
    return json_build_object('ok', false, 'error', 'Nombre inválido: 2 a 30 letras, números o espacios');
  end if;
  if v_n in ('OPERARIO','ESTAJERO','SUPERVISORA','INGENIERIA','COSTOS') then
    return json_build_object('ok', false, 'error', 'Ese nombre ya es un rol del sistema');
  end if;
  select coalesce(array_agg(distinct trim(x)), '{}') into v_p from unnest(coalesce(p_pestanas, '{}')) x where trim(x) <> '';
  insert into roles_sistema (nombre, pestanas, creado_por) values (v_n, v_p, o.dni)
  on conflict (nombre) do update set pestanas = excluded.pestanas;
  for r in select dni from operarios where cargo = v_n loop
    perform _rol_aplicar(r.dni, v_n); v_c := v_c + 1;
  end loop;
  return json_build_object('ok', true, 'aplicados', v_c);
end $function$;

create or replace function public.fn_roles_eliminar(p_dni text, p_token uuid, p_nombre text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_n text := upper(trim(coalesce(p_nombre, '')));
begin
  o := _admin(p_dni, p_token);
  if exists (select 1 from operarios where cargo = v_n) then
    return json_build_object('ok', false, 'error', 'Hay personas con ese rol: cámbiales el rol antes de borrarlo');
  end if;
  delete from roles_sistema where nombre = v_n;
  return json_build_object('ok', true);
end $function$;

grant execute on function public.fn_roles_listar(text, text) to anon, authenticated;
grant execute on function public.fn_roles_guardar(text, uuid, text, text[]) to anon, authenticated;
grant execute on function public.fn_roles_eliminar(text, uuid, text) to anon, authenticated;

-- Quien ya tenga el rol UDP recibe sus pestañas ahora.
do $$ declare r record; begin
  for r in select dni from operarios where cargo = 'UDP' loop perform _rol_aplicar(r.dni, 'UDP'); end loop;
end $$;

commit;
