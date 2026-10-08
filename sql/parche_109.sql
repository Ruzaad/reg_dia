-- PARCHE 109 — Sesiones prestadas: "Entrar como" sin PIN y con registro
-- Hoy "Entrar como operario" usa fn_login con el PIN del operario: le cambia
-- el token (su celular queda deslogueado) y en la base no queda quién entró.
-- "Operar como supervisora" usa el token del ingeniero y no se distingue de lo
-- que registra desde Ingeniería.
--
-- Con este parche:
--   * Ingeniería abre una sesión prestada con motivo, SIN el PIN del operario
--     y sin tocar su token: el celular del operario sigue funcionando.
--   * Solo quien tiene la pestaña "Operar como operario" (pasoOpArea) o
--     "Operar como supervisora" (pasoSupArea) y EDICIÓN en esa área (o el
--     administrador). Lo valida la base.
--   * La sesión prestada se cierra sola a los 60 min sin uso y como máximo a
--     las 8 h; "Volver a Ingeniería" la cierra al instante.
--   * Lo que se registra con ella (reclamos, incidencias y cambios de área)
--     queda marcado con la sesión: Gestión › Sesiones prestadas lo muestra.
-- _auth solo cambia cuando el token no es el del operario: el camino normal
-- de todos los demás queda igual.
-- Rollback: parche_109_rollback.sql.
begin;

create table if not exists public.sesiones_prestadas (
  id         bigserial primary key,
  ing_dni    text not null,                 -- quien entra
  tipo       text not null check (tipo in ('OP','SUP')),
  como_dni   text not null,                 -- con qué DNI opera (OP: el operario; SUP: el mismo ingeniero)
  area       text,
  motivo     text,
  equipo     text,
  token      uuid not null default gen_random_uuid(),
  inicio     timestamptz not null default now(),
  ultimo_uso timestamptz not null default now(),
  fin        timestamptz,
  cierre     text                           -- VOLVIO, VENCIO, CERRADA_POR <dni>
);
create unique index if not exists sesiones_prestadas_token on public.sesiones_prestadas (token);
create index if not exists sesiones_prestadas_inicio on public.sesiones_prestadas (inicio);
alter table public.sesiones_prestadas enable row level security;
revoke all on public.sesiones_prestadas from anon, authenticated;

alter table public.reclamos add column if not exists prestada_id bigint;
alter table public.ocurrencias add column if not exists prestada_id bigint;
alter table public.movimientos_area add column if not exists prestada_id bigint;

-- Marca lo registrado con una sesión prestada (la pone _auth en app.prestada).
create or replace function public._marcar_prestada()
 returns trigger language plpgsql as $$
begin
  new.prestada_id := coalesce(new.prestada_id, nullif(current_setting('app.prestada', true), '')::bigint);
  return new;
end $$;
drop trigger if exists marcar_prestada on public.reclamos;
create trigger marcar_prestada before insert on public.reclamos for each row execute function public._marcar_prestada();
drop trigger if exists marcar_prestada on public.ocurrencias;
create trigger marcar_prestada before insert on public.ocurrencias for each row execute function public._marcar_prestada();
drop trigger if exists marcar_prestada on public.movimientos_area;
create trigger marcar_prestada before insert on public.movimientos_area for each row execute function public._marcar_prestada();

-- _auth: igual que antes; si el token no es el del operario, prueba una sesión prestada viva.
create or replace function public._auth(p_dni text, p_token uuid)
 returns operarios
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  o operarios;
  sp sesiones_prestadas;
  v_idle  interval := interval '4 hours';
  v_max   interval := interval '18 hours';
  v_nuevo timestamptz;
begin
  select * into o from operarios
   where dni = p_dni and token = p_token
     and token_expira > now() and estado = 'ACTIVO';
  if not found then
    -- Sesión prestada (parche 109): token propio, no toca el del operario.
    select * into sp from sesiones_prestadas
     where token = p_token and como_dni = p_dni and fin is null
       and ultimo_uso > now() - interval '60 minutes' and inicio > now() - interval '8 hours';
    if sp.id is null then raise exception 'SESION_INVALIDA'; end if;
    -- Quien la abrió debe seguir activo.
    if not exists (select 1 from operarios where dni = sp.ing_dni and estado = 'ACTIVO') then raise exception 'SESION_INVALIDA'; end if;
    select * into o from operarios where dni = p_dni and estado = 'ACTIVO';
    if not found then raise exception 'SESION_INVALIDA'; end if;
    if not fn_horario_ok() then raise exception 'FUERA_DE_HORARIO'; end if;
    if sp.ultimo_uso < now() - interval '1 minute' then
      update sesiones_prestadas set ultimo_uso = now() where id = sp.id;
    end if;
    perform set_config('app.prestada', sp.id::text, true);
    perform _perm_set(o);
    return o;
  end if;

  if not fn_horario_ok() then raise exception 'FUERA_DE_HORARIO'; end if;

  v_nuevo := least(now() + v_idle, coalesce(o.token_creado, now()) + v_max);
  if o.token_expira < now() + (v_idle / 2) and v_nuevo > o.token_expira then
    update operarios set token_expira = v_nuevo where dni = o.dni;
    o.token_expira := v_nuevo;
  end if;

  perform _perm_set(o);
  return o;
end $function$;

-- ¿Puede prestar en esa área? Administrador, o la pestaña y Edición en el área.
create or replace function public._puede_prestar(o operarios, p_tipo text, p_area text)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(o.es_admin,false)
      or (o.cargo not in ('OPERARIO','ESTAJERO','SUPERVISORA')
          and exists (select 1 from permisos_pestana where dni = o.dni
                       and pestana = case p_tipo when 'OP' then 'pasoOpArea' else 'pasoSupArea' end)
          and exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR' and area in ('*', p_area)))
$$;
revoke all on function public._puede_prestar(operarios, text, text) from public, anon, authenticated;

-- Abre una sesión prestada. OP: como el operario p_como_dni. SUP: como uno mismo en p_area.
create or replace function public.fn_prestar_sesion(p_dni text, p_token uuid, p_tipo text, p_como_dni text, p_area text, p_motivo text, p_equipo text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; c operarios; v_area text; sp sesiones_prestadas;
        v_mot text := nullif(trim(coalesce(p_motivo,'')),'');
begin
  o := _auth(p_dni, p_token);
  if current_setting('app.prestada', true) is not null and current_setting('app.prestada', true) <> '' then
    raise exception 'NO_AUTORIZADA: no se presta desde una sesión prestada';
  end if;
  if p_tipo = 'OP' then
    select * into c from operarios where dni = trim(p_como_dni) and estado = 'ACTIVO';
    if c.dni is null or c.cargo not in ('OPERARIO','ESTAJERO') then return json_build_object('ok', false, 'error', 'Ese DNI no es de un operario activo'); end if;
    v_area := coalesce(nullif(p_area,''), c.area_actual);
    if v_mot is null then return json_build_object('ok', false, 'error', 'Indica el motivo'); end if;
  elsif p_tipo = 'SUP' then
    c := o; v_area := nullif(p_area,'');
    if v_area is null then return json_build_object('ok', false, 'error', 'Elige el área'); end if;
  else
    return json_build_object('ok', false, 'error', 'Tipo inválido');
  end if;
  if not _puede_prestar(o, p_tipo, v_area)
     or (p_tipo = 'OP' and c.area_actual is not null and not _puede_prestar(o, p_tipo, c.area_actual)) then
    raise exception 'NO_AUTORIZADA_AREA: no puedes % en %', case p_tipo when 'OP' then 'entrar como operario' else 'operar como supervisora' end, coalesce(v_area, c.area_actual);
  end if;
  -- Una prestada viva por persona y tipo: la anterior se cierra.
  update sesiones_prestadas set fin = now(), cierre = 'REEMPLAZADA'
   where ing_dni = o.dni and tipo = p_tipo and fin is null;
  insert into sesiones_prestadas (ing_dni, tipo, como_dni, area, motivo, equipo)
  values (o.dni, p_tipo, c.dni, v_area, v_mot, left(nullif(p_equipo,''), 120)) returning * into sp;
  return json_build_object('ok', true, 'id', sp.id, 'token', sp.token, 'dni', c.dni, 'nombre', c.nombres_apellidos,
    'cargo', c.cargo, 'area_actual', case when p_tipo = 'SUP' then v_area else c.area_actual end, 'es_admin', coalesce(c.es_admin,false));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Cerrar: la propia (con su token prestado o el de Ingeniería) o, el administrador, cualquiera.
create or replace function public.fn_prestada_cerrar(p_dni text, p_token uuid, p_id bigint)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare sp sesiones_prestadas; o operarios;
begin
  select * into sp from sesiones_prestadas where id = p_id;
  if sp.id is null then return json_build_object('ok', false, 'error', 'No existe'); end if;
  if sp.fin is not null then return json_build_object('ok', true, 'ya', true); end if;
  if sp.token = p_token and sp.como_dni = p_dni then
    update sesiones_prestadas set fin = now(), cierre = 'VOLVIO' where id = sp.id;
    return json_build_object('ok', true);
  end if;
  o := _auth(p_dni, p_token);
  if o.dni = sp.ing_dni then
    update sesiones_prestadas set fin = now(), cierre = 'VOLVIO' where id = sp.id;
  elsif coalesce(o.es_admin,false) then
    update sesiones_prestadas set fin = now(), cierre = 'CERRADA_POR ' || o.dni where id = sp.id;
  else
    raise exception 'NO_AUTORIZADA: solo quien la abrió o el administrador';
  end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Gestión › Sesiones prestadas: las del día en tus áreas, con lo registrado.
create or replace function public.fn_sesiones_prestadas(p_dni text, p_token uuid, p_fecha date, p_area text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_f date := coalesce(p_fecha, _hoy()); v_areas text[];
begin
  o := _vista(p_dni, p_token, array['pasoPrestadas'], nullif(p_area,''));
  if coalesce(o.es_admin,false) or exists (select 1 from permisos_area where dni = o.dni and area = '*') then v_areas := null;
  else select coalesce(array_agg(area), '{}') into v_areas from permisos_area where dni = o.dni; end if;
  update sesiones_prestadas set fin = least(ultimo_uso + interval '60 minutes', inicio + interval '8 hours'), cierre = 'VENCIO'
   where fin is null and (ultimo_uso <= now() - interval '60 minutes' or inicio <= now() - interval '8 hours');
  return json_build_object('ok', true, 'fecha', v_f, 'admin', coalesce(o.es_admin,false), 'items', coalesce((
    select json_agg(x order by x.inicio desc) from (
      select sp.id, sp.tipo, sp.ing_dni, oi.nombres_apellidos ing_nombre, sp.como_dni, oc.nombres_apellidos como_nombre,
             sp.area, sp.motivo, sp.equipo, sp.inicio, sp.ultimo_uso, sp.fin, sp.cierre,
             (select count(*) from reclamos r where r.prestada_id = sp.id) reclamos,
             (select count(*) from ocurrencias c where c.prestada_id = sp.id) incidencias,
             (select count(*) from movimientos_area m where m.prestada_id = sp.id) movimientos
        from sesiones_prestadas sp
        left join operarios oi on oi.dni = sp.ing_dni
        left join operarios oc on oc.dni = sp.como_dni
       where (sp.inicio at time zone 'America/Lima')::date = v_f
         and (nullif(p_area,'') is null or sp.area = p_area)
         and (v_areas is null or sp.area = any(v_areas))) x), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_sesion_prestada_detalle(p_dni text, p_token uuid, p_id bigint)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; sp sesiones_prestadas;
begin
  select * into sp from sesiones_prestadas where id = p_id;
  if sp.id is null then return json_build_object('ok', false, 'error', 'No existe'); end if;
  o := _vista(p_dni, p_token, array['pasoPrestadas'], sp.area);
  return json_build_object('ok', true,
    'reclamos', coalesce((select json_agg(json_build_object('fecha', r.fecha, 'creado', r.creado, 'o_f', r.o_f, 'modulo', r.modulo, 'op', r.op, 'numeracion', r.numeracion, 'minutos', r.minutos, 'estado', r.estado) order by r.id)
                            from reclamos r where r.prestada_id = sp.id), '[]'::json),
    'incidencias', coalesce((select json_agg(json_build_object('fecha', c.fecha, 'creado', c.creado, 'tipo', c.tipo, 'minutos', c.minutos, 'detalle', c.detalle) order by c.id)
                               from ocurrencias c where c.prestada_id = sp.id), '[]'::json),
    'movimientos', coalesce((select json_agg(row_to_json(m)) from movimientos_area m where m.prestada_id = sp.id), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
