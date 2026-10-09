-- PARCHE 116 — Trabajo por tiempo: lotes de DESPACHO, REPROCESO y CORTE
-- Estas áreas no tienen OF ni BASE: hoy su día queda como incidencia. Un lote
-- es área + cliente o destino + tarea de una lista corta + cantidad de prendas
-- (OF opcional). El operario marca EMPEZAR y TERMINAR en su celular (la hora la
-- pone el servidor) y al terminar dice cuántas prendas hizo.
--
-- NO cambia ningún cálculo: `_ausente`, boletas, eficiencia e incentivos
-- siguen igual. Los minutos en lotes se ven aparte (decisión pendiente si
-- EN DESPACHO / EN REPROCESO / EN CORTE pasan a exigir 575 min).
--
-- Quién trabaja en lotes hoy: el personal de CORTE y REPROCESO, y quien tiene
-- hoy en asistencia EN DESPACHO, EN REPROCESO o EN CORTE.
-- Quién crea y cierra lotes: la supervisora del área (la de ACABADO para
-- DESPACHO y REPROCESO, porque es su gente), Ingeniería con Edición en el
-- área (o en ACABADO para DESPACHO y REPROCESO) y el administrador.
-- Quién ve: lo mismo con Lectura y la pestaña "Trabajo por tiempo" (pasoLotes).
-- Un tramo abierto de un día anterior se cierra solo a las 18:20 y queda
-- "por revisar" para que la supervisora ponga la cantidad.
-- Rollback: parche_116_rollback.sql (borra las tablas: solo antes de usarlo).
begin;

create table if not exists public.lote_tareas (
  id      serial primary key,
  area    text not null,
  nombre  text not null,
  std     numeric,                       -- min por prenda medido (Tiempos); null = sin estándar
  activo  boolean not null default true,
  creado  timestamptz not null default now(),
  unique (area, nombre)
);
create table if not exists public.lotes (
  id          serial primary key,
  area        text not null check (area in ('DESPACHO','REPROCESO','CORTE')),
  destino     text not null,
  tarea       text not null,
  cantidad    integer not null check (cantidad > 0),
  o_f         text,
  estado      text not null default 'ABIERTO' check (estado in ('ABIERTO','CERRADO')),
  creado_por  text not null,
  creado      timestamptz not null default now(),
  cerrado_por text,
  cerrado     timestamptz
);
create index if not exists lotes_area_estado on public.lotes (area, estado);
create table if not exists public.lote_tramos (
  id           bigserial primary key,
  lote_id      integer not null references public.lotes(id),
  dni          text not null,
  inicio       timestamptz not null default now(),
  fin          timestamptz,
  prendas      integer check (prendas >= 0),
  auto         boolean not null default false,   -- se cerró solo a la salida
  revisado_por text,
  revisado     timestamptz
);
create unique index if not exists lote_tramos_uno_abierto on public.lote_tramos (dni) where fin is null;
create index if not exists lote_tramos_lote on public.lote_tramos (lote_id);
create index if not exists lote_tramos_inicio on public.lote_tramos (inicio);
alter table public.lote_tareas enable row level security;
alter table public.lotes enable row level security;
alter table public.lote_tramos enable row level security;
revoke all on public.lote_tareas, public.lotes, public.lote_tramos from anon, authenticated;

insert into public.lote_tareas (area, nombre) values
  ('DESPACHO','EMBOLSAR'), ('DESPACHO','ETIQUETAR'), ('DESPACHO','DOBLAR Y ENCAJAR'), ('DESPACHO','CONTAR'), ('DESPACHO','HABILITAR'),
  ('REPROCESO','DESMANCHAR'), ('REPROCESO','REPASAR'), ('REPROCESO','DESCOSER Y RECOSER'), ('REPROCESO','PLANCHAR'), ('REPROCESO','ETIQUETAR'),
  ('CORTE','TENDIDO'), ('CORTE','CORTE'), ('CORTE','HABILITADO'), ('CORTE','NUMERADO')
on conflict (area, nombre) do nothing;

-- Minutos de un tramo sin el refrigerio (13:00 a 13:45, hora Lima).
create or replace function public._tramo_min(p_ini timestamptz, p_fin timestamptz)
 returns numeric language sql immutable as $$
  with x as (select (p_ini at time zone 'America/Lima') i, (p_fin at time zone 'America/Lima') f),
       r as (select i, f, i::date + time '13:00' ri, i::date + time '13:45' rf from x)
  select round(greatest(0, extract(epoch from (f - i)) / 60
         - greatest(0, extract(epoch from (least(f, rf) - greatest(i, ri))) / 60))::numeric, 1)
    from r where f is not null
$$;

-- Cierra a las 18:20 los tramos que quedaron abiertos de un día anterior.
create or replace function public._lotes_autocierre()
 returns void language sql security definer set search_path to 'public' as $$
  update lote_tramos t
     set fin = greatest(t.inicio, (((t.inicio at time zone 'America/Lima')::date + time '18:20') at time zone 'America/Lima')),
         auto = true
   where t.fin is null and (t.inicio at time zone 'America/Lima')::date < _hoy()
$$;
revoke all on function public._lotes_autocierre() from public, anon, authenticated;

-- Área de lotes de una persona hoy (null = no trabaja por tiempo hoy).
create or replace function public._lote_area_hoy(o operarios)
 returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select case a.estado when 'EN DESPACHO' then 'DESPACHO' when 'EN REPROCESO' then 'REPROCESO' when 'EN CORTE' then 'CORTE' end
       from asistencia a where a.dni = o.dni and a.fecha = _hoy()
      order by a.creado desc limit 1),
    case when o.area_actual in ('CORTE','REPROCESO') then o.area_actual end)
$$;
revoke all on function public._lote_area_hoy(operarios) from public, anon, authenticated;

-- ¿Puede ver (p_editar=false) o crear y cerrar (true) lotes de esa área?
create or replace function public._lote_permiso(o operarios, p_area text, p_editar boolean)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(o.es_admin,false)
      or (o.cargo = 'SUPERVISORA' and (o.area_actual = p_area
            or (o.area_actual = 'ACABADO' and p_area in ('DESPACHO','REPROCESO'))))
      or (o.cargo not in ('OPERARIO','ESTAJERO','SUPERVISORA')
          and exists (select 1 from permisos_pestana where dni = o.dni and pestana = 'pasoLotes')
          and exists (select 1 from permisos_area pa where pa.dni = o.dni
                        and (pa.area in ('*', p_area) or (pa.area = 'ACABADO' and p_area in ('DESPACHO','REPROCESO')))
                        and (not p_editar or pa.nivel = 'EDITAR')))
$$;
revoke all on function public._lote_permiso(operarios, text, boolean) from public, anon, authenticated;

-- Un lote con lo hecho hasta ahora.
create or replace function public._lote_json(l lotes)
 returns json language sql stable security definer set search_path to 'public' as $$
  select json_build_object('id', l.id, 'area', l.area, 'destino', l.destino, 'tarea', l.tarea, 'cantidad', l.cantidad,
    'o_f', l.o_f, 'estado', l.estado, 'creado', l.creado, 'cerrado', l.cerrado,
    'hecho', coalesce(sum(t.prendas), 0),
    'min', coalesce(sum(_tramo_min(t.inicio, coalesce(t.fin, now()))), 0),
    'min_hoy', coalesce(sum(_tramo_min(greatest(t.inicio, (_hoy()::timestamp at time zone 'America/Lima')), coalesce(t.fin, now())))
                         filter (where coalesce(t.fin, now()) >= (_hoy()::timestamp at time zone 'America/Lima')), 0),
    'min_contado', coalesce(sum(_tramo_min(t.inicio, t.fin)) filter (where t.prendas is not null), 0),
    'ahora', count(*) filter (where t.fin is null),
    'personas', count(distinct t.dni),
    'por_revisar', count(*) filter (where t.fin is not null and t.prendas is null and t.revisado is null),
    'std', (select k.std from lote_tareas k where k.area = l.area and k.nombre = l.tarea))
  from lote_tramos t where t.lote_id = l.id
$$;
revoke all on function public._lote_json(lotes) from public, anon, authenticated;

-- ---------- Operario ----------
create or replace function public.fn_lotes_mios(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_area text; v_act lote_tramos;
begin
  o := _auth(p_dni, p_token);
  perform _lotes_autocierre();
  v_area := _lote_area_hoy(o);
  select * into v_act from lote_tramos where dni = o.dni and fin is null;
  if v_area is null and v_act.id is null then return json_build_object('ok', true, 'area', null); end if;
  return json_build_object('ok', true, 'area', v_area, 'ahora', now(),
    'lotes', coalesce((select json_agg(_lote_json(l) order by l.creado desc) from lotes l
                        where l.area = v_area and l.estado = 'ABIERTO'), '[]'::json),
    'actual', case when v_act.id is null then null else (
      select json_build_object('id', v_act.id, 'inicio', v_act.inicio, 'lote', _lote_json(l)) from lotes l where l.id = v_act.lote_id) end,
    'hoy', coalesce((select json_agg(json_build_object('id', t.id, 'inicio', t.inicio, 'fin', t.fin, 'prendas', t.prendas, 'auto', t.auto,
                        'min', _tramo_min(t.inicio, coalesce(t.fin, now())), 'destino', l.destino, 'tarea', l.tarea, 'area', l.area) order by t.inicio)
                       from lote_tramos t join lotes l on l.id = t.lote_id
                      where t.dni = o.dni and (t.inicio at time zone 'America/Lima')::date = _hoy()), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Empieza un lote. Si tenía otro abierto, lo cierra (sin prendas: por revisar).
create or replace function public.fn_lote_empezar(p_dni text, p_token uuid, p_lote integer)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; l lotes; v_area text; v_id bigint;
begin
  o := _auth(p_dni, p_token);
  perform pg_advisory_xact_lock(hashtext('lote:' || o.dni));
  perform _lotes_autocierre();
  select * into l from lotes where id = p_lote;
  if l.id is null or l.estado <> 'ABIERTO' then return json_build_object('ok', false, 'error', 'Ese lote ya se cerró'); end if;
  v_area := _lote_area_hoy(o);
  if v_area is distinct from l.area then
    return json_build_object('ok', false, 'error', 'Hoy no estás en ' || l.area || '. Pide a tu supervisora que te marque EN ' || l.area || '.');
  end if;
  if exists (select 1 from lote_tramos where dni = o.dni and fin is null and lote_id = l.id) then
    return json_build_object('ok', true, 'repetido', true);
  end if;
  update lote_tramos set fin = now() where dni = o.dni and fin is null;
  insert into lote_tramos (lote_id, dni) values (l.id, o.dni) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'inicio', now());
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Termina el lote en curso. p_prendas null = "que lo ponga mi supervisora".
create or replace function public.fn_lote_terminar(p_dni text, p_token uuid, p_prendas integer)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; t lote_tramos;
begin
  o := _auth(p_dni, p_token);
  perform pg_advisory_xact_lock(hashtext('lote:' || o.dni));
  if p_prendas is not null and (p_prendas < 0 or p_prendas > 100000) then
    return json_build_object('ok', false, 'error', 'Cantidad inválida');
  end if;
  update lote_tramos set fin = now(), prendas = p_prendas where dni = o.dni and fin is null returning * into t;
  if t.id is null then
    -- Doble toque: el primero ya lo cerró. Si fue hace instantes, se toma como el mismo.
    select * into t from lote_tramos where dni = o.dni and fin > now() - interval '2 minutes' order by fin desc limit 1;
    if t.id is not null then return json_build_object('ok', true, 'repetido', true, 'min', _tramo_min(t.inicio, t.fin)); end if;
    return json_build_object('ok', false, 'error', 'No tienes un lote en curso');
  end if;
  return json_build_object('ok', true, 'min', _tramo_min(t.inicio, t.fin));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- Supervisora e Ingeniería ----------
create or replace function public.fn_lote_tareas(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public' as $function$
begin
  perform _auth(p_dni, p_token);
  return coalesce((select json_agg(json_build_object('area', area, 'nombre', nombre, 'std', std) order by area, id)
                     from lote_tareas where activo), '[]'::json);
end $function$;

create or replace function public.fn_lote_crear(p_dni text, p_token uuid, p_area text, p_destino text, p_tarea text, p_cantidad integer, p_of text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_id integer;
        v_area text := upper(trim(coalesce(p_area,'')));
        v_dest text := upper(trim(coalesce(p_destino,'')));
        v_tar  text := upper(trim(coalesce(p_tarea,'')));
        v_of   text := nullif(upper(trim(coalesce(p_of,''))),'');
begin
  o := _auth(p_dni, p_token);
  if v_area not in ('DESPACHO','REPROCESO','CORTE') then return json_build_object('ok', false, 'error', 'Área inválida'); end if;
  if not _lote_permiso(o, v_area, true) then raise exception 'NO_AUTORIZADA_AREA: no puedes crear lotes en %', v_area; end if;
  if v_dest = '' or v_tar = '' then return json_build_object('ok', false, 'error', 'Falta el destino o la tarea'); end if;
  if coalesce(p_cantidad,0) <= 0 then return json_build_object('ok', false, 'error', 'Pon la cantidad de prendas'); end if;
  perform pg_advisory_xact_lock(hashtext('lote_crear:' || o.dni));
  select id into v_id from lotes where creado_por = o.dni and area = v_area and destino = v_dest and tarea = v_tar
     and cantidad = p_cantidad and creado > now() - interval '2 minutes';
  if v_id is not null then return json_build_object('ok', true, 'id', v_id, 'repetido', true); end if;
  insert into lote_tareas (area, nombre) values (v_area, v_tar) on conflict (area, nombre) do nothing;
  insert into lotes (area, destino, tarea, cantidad, o_f, creado_por) values (v_area, v_dest, v_tar, p_cantidad, v_of, o.dni)
    returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Cerrar (o reabrir) un lote. Al cerrar, quien seguía trabajando en él termina sin prendas.
create or replace function public.fn_lote_cerrar(p_dni text, p_token uuid, p_lote integer, p_cerrar boolean)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; l lotes;
begin
  o := _auth(p_dni, p_token);
  select * into l from lotes where id = p_lote;
  if l.id is null then return json_build_object('ok', false, 'error', 'No existe el lote'); end if;
  if not _lote_permiso(o, l.area, true) then raise exception 'NO_AUTORIZADA_AREA: no puedes cerrar lotes en %', l.area; end if;
  if p_cerrar then
    update lote_tramos set fin = now() where lote_id = l.id and fin is null;
    update lotes set estado = 'CERRADO', cerrado = now(), cerrado_por = o.dni where id = l.id;
  else
    update lotes set estado = 'ABIERTO', cerrado = null, cerrado_por = null where id = l.id;
  end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Panel: lotes abiertos y los cerrados en el día, por área, y tramos por revisar.
create or replace function public.fn_lotes_panel(p_dni text, p_token uuid, p_area text, p_fecha date)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_areas text[]; v_f date := coalesce(p_fecha, _hoy());
        v_ini timestamptz; v_fin timestamptz;
begin
  o := _auth(p_dni, p_token);
  perform _lotes_autocierre();
  select array_agg(a) into v_areas from unnest(array['DESPACHO','REPROCESO','CORTE']) a
   where (nullif(p_area,'') is null or a = p_area) and _lote_permiso(o, a, false);
  if v_areas is null then raise exception 'NO_AUTORIZADA: sin acceso a Trabajo por tiempo'; end if;
  v_ini := v_f::timestamp at time zone 'America/Lima'; v_fin := (v_f + 1)::timestamp at time zone 'America/Lima';
  return json_build_object('ok', true, 'fecha', v_f,
    'areas', (select json_agg(json_build_object('area', a, 'edita', _lote_permiso(o, a, true),
        'ahora', (select count(*) from lote_tramos t join lotes l on l.id = t.lote_id where l.area = a and t.fin is null),
        'min', (select coalesce(sum(_tramo_min(greatest(t.inicio, v_ini), least(coalesce(t.fin, now()), v_fin))), 0)
                  from lote_tramos t join lotes l on l.id = t.lote_id
                 where l.area = a and t.inicio < v_fin and coalesce(t.fin, now()) > v_ini),
        'personas', (select count(distinct t.dni) from lote_tramos t join lotes l on l.id = t.lote_id
                      where l.area = a and t.inicio < v_fin and coalesce(t.fin, now()) > v_ini),
        'abiertos', (select count(*) from lotes l where l.area = a and l.estado = 'ABIERTO')) order by a)
      from unnest(v_areas) a),
    'lotes', coalesce((select json_agg(_lote_json(l) order by l.estado, l.creado desc) from lotes l
                        where l.area = any(v_areas)
                          and (l.estado = 'ABIERTO' or l.cerrado between v_ini and v_fin
                               or exists (select 1 from lote_tramos t where t.lote_id = l.id and t.inicio < v_fin and coalesce(t.fin, now()) > v_ini))), '[]'::json),
    'por_revisar', coalesce((select json_agg(json_build_object('id', t.id, 'lote', l.id, 'area', l.area, 'destino', l.destino, 'tarea', l.tarea,
                        'dni', t.dni, 'nombre', op.nombres_apellidos, 'inicio', t.inicio, 'fin', t.fin, 'auto', t.auto,
                        'min', _tramo_min(t.inicio, t.fin)) order by t.inicio)
                       from lote_tramos t join lotes l on l.id = t.lote_id left join operarios op on op.dni = t.dni
                      where l.area = any(v_areas) and t.fin is not null and t.prendas is null and t.revisado is null
                        and t.inicio > now() - interval '30 days'), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_lote_detalle(p_dni text, p_token uuid, p_lote integer)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; l lotes;
begin
  o := _auth(p_dni, p_token);
  select * into l from lotes where id = p_lote;
  if l.id is null then return json_build_object('ok', false, 'error', 'No existe el lote'); end if;
  if not _lote_permiso(o, l.area, false) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a %', l.area; end if;
  return json_build_object('ok', true, 'lote', _lote_json(l), 'edita', _lote_permiso(o, l.area, true),
    'tramos', coalesce((select json_agg(json_build_object('id', t.id, 'dni', t.dni, 'nombre', op.nombres_apellidos, 'inicio', t.inicio,
                  'fin', t.fin, 'prendas', t.prendas, 'auto', t.auto, 'revisado', t.revisado is not null,
                  'min', _tramo_min(t.inicio, coalesce(t.fin, now()))) order by t.inicio desc)
                 from lote_tramos t left join operarios op on op.dni = t.dni where t.lote_id = l.id), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Poner la cantidad (y si hace falta la hora de fin) de un tramo por revisar.
create or replace function public.fn_lote_tramo_revisar(p_dni text, p_token uuid, p_tramo bigint, p_prendas integer, p_fin text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; t lote_tramos; l lotes; v_fin timestamptz;
begin
  o := _auth(p_dni, p_token);
  select * into t from lote_tramos where id = p_tramo;
  if t.id is null or t.fin is null then return json_build_object('ok', false, 'error', 'Ese tramo sigue en curso'); end if;
  select * into l from lotes where id = t.lote_id;
  if not _lote_permiso(o, l.area, true) then raise exception 'NO_AUTORIZADA_AREA: no puedes revisar lotes en %', l.area; end if;
  if p_prendas is null or p_prendas < 0 then return json_build_object('ok', false, 'error', 'Pon la cantidad'); end if;
  v_fin := t.fin;
  if nullif(p_fin,'') is not null then
    v_fin := (((t.inicio at time zone 'America/Lima')::date + p_fin::time) at time zone 'America/Lima');
    if v_fin <= t.inicio then return json_build_object('ok', false, 'error', 'La hora de fin debe ser después del inicio'); end if;
  end if;
  update lote_tramos set prendas = p_prendas, fin = v_fin, revisado = now(), revisado_por = o.dni where id = t.id;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
