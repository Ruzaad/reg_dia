-- PARCHE 119 — Tiempos de las áreas sin OF: minutaje y tope en los lotes
-- Va sobre el parche 116 (trabajo por tiempo).
--
-- 1. Ingeniería sube el tiempo (min por prenda) de cada tarea de DESPACHO,
--    REPROCESO y CORTE: Ingeniería › Trabajo por tiempo › Tiempos por tarea.
--    Puede pegarlos desde Excel. Queda quién y cuándo (lote_tareas_log).
-- 2. Minutaje igual que ACABADO: cuando un tramo se cierra con prendas y la
--    tarea tiene tiempo, se guarda un reclamo (prendas × tiempo) para el
--    operario, con la fecha del tramo. Desde ahí entra solo a Mi día, la
--    boleta, la eficiencia y los incentivos, como cualquier ticket. El tiempo
--    queda congelado en el reclamo (como el STD de un ticket): cambiarlo
--    después no toca lo ya registrado.
--    Sin tiempo no se genera nada: el lote se ve aparte, como en el 116.
-- 3. Tope igual que ACABADO: la suma de prendas de un lote no pasa de su
--    cantidad. Al terminar o al revisar sale "van X de Y, quedan Z". Quien
--    crea lotes puede corregir la cantidad (nunca por debajo de lo hecho).
-- 4. El reclamo de un lote no mueve de área a la persona (quien está EN
--    DESPACHO sigue siendo de ACABADO).
--
-- Rollback: parche_119_rollback.sql (borra el minutaje de lotes y vuelve a 116).
begin;

-- ---------- Tablas ----------
alter table public.lote_tareas add column if not exists actualizado timestamptz;
alter table public.lote_tareas add column if not exists actualizado_por text;

create table if not exists public.lote_tareas_log (
  id         bigserial primary key,
  tarea_id   integer not null references public.lote_tareas(id) on delete cascade,
  std_antes  numeric,
  std_nuevo  numeric,
  activo     boolean,
  por        text not null,
  creado     timestamptz not null default now()
);
alter table public.lote_tareas_log enable row level security;
revoke all on public.lote_tareas_log from anon, authenticated;

alter table public.reclamos add column if not exists lote_tramo_id bigint references public.lote_tramos(id) on delete cascade;
create unique index if not exists reclamos_lote_tramo on public.reclamos (lote_tramo_id) where lote_tramo_id is not null;

-- ---------- El reclamo de un lote no mueve de área ----------
-- Igual que en producción, con la primera línea nueva.
create or replace function public._reclamo_mueve_area()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_prev text; v_nom text; v_motivo text; v_hora time; v_ts timestamptz; v_ult timestamptz;
begin
  if NEW.lote_tramo_id is not null then return NEW; end if;   -- parche 119: minutaje de un lote
  if NEW.area is null or NEW.estado <> 'ACTIVO' then return NEW; end if;

  select area_actual, nombres_apellidos into v_prev, v_nom
    from operarios where dni = NEW.dni;
  /* Ya está en esa área (el caso normal, y también el resto de un lote de 60:
     la primera fila lo movió). */
  if v_prev is null or v_prev = NEW.area then return NEW; end if;

  /* La hora que declaró al elegir el área (parche 90). Si queda antes de su
     último cambio del día no sirve: se usa la de registro. */
  select hora into v_hora from area_hora_declarada
   where dni = NEW.dni and fecha = _hoy() and area = NEW.area;
  if v_hora is not null then
    v_ts := (_hoy()::text || ' ' || to_char(v_hora,'HH24:MI'))::timestamp at time zone 'America/Lima';
    select max(creado) into v_ult from movimientos_area where dni = NEW.dni and fecha = _hoy();
    if v_ts > now() or (v_ult is not null and v_ts < v_ult) then v_ts := null; end if;
    delete from area_hora_declarada where dni = NEW.dni and fecha = _hoy() and area = NEW.area;
  end if;

  update operarios set area_actual = NEW.area where dni = NEW.dni;
  insert into movimientos_area (dni, area_anterior, area_nueva, movido_por, creado, origen)
  values (NEW.dni, v_prev, NEW.area, NEW.dni, coalesce(v_ts, now()),
          case when v_ts is not null then 'DECLARADO' else 'RECLAMO' end);

  /* Un aviso para ingeniería y otro para la supervisora del área DESTINO, que
     es quien lo va a tener en su equipo. El motivo tiene que ser exacto: decir
     "se movió solo" cuando fue ingeniería quien le asignó el trabajo haría que
     nadie vuelva a creerle a la notificación. */
  v_motivo := case when coalesce(current_setting('samitex.asignando', true),'') = 'on'
                   then 'Ingeniería le asignó tickets de '||NEW.area
                   else 'Se movió solo al reclamar un ticket de '||NEW.area end
           || case when v_ts is not null
                   then ', dice que está ahí desde las '||to_char(v_ts at time zone 'America/Lima','HH24:MI')
                   else ', sin decir desde qué hora' end;
  insert into notificaciones (tipo, para_cargo, para_area, dni_afectado, titulo, detalle)
  values ('CAMBIO_AREA','INGENIERIA', null, NEW.dni,
          coalesce(v_nom, NEW.dni)||' pasó a '||NEW.area,
          'Venía de '||v_prev||'. '||v_motivo||' (OF '||coalesce(NEW.o_f,'—')||').'),
         ('CAMBIO_AREA','SUPERVISORA', NEW.area, NEW.dni,
          coalesce(v_nom, NEW.dni)||' entró a tu área',
          'Venía de '||v_prev||'. '||v_motivo||' (OF '||coalesce(NEW.o_f,'—')||').');
  return NEW;
end $function$;

-- ---------- Minutaje de un tramo ----------
-- Crea, corrige o borra el reclamo de un tramo. Quien llama ya validó el permiso.
-- Si el reclamo ya existe, conserva su tiempo (congelado) y solo cambia la cantidad.
create or replace function public._lote_minutaje(p_tramo bigint)
 returns numeric language plpgsql security definer set search_path to 'public' as $function$
declare t lote_tramos; l lotes; v_std numeric; v_cargo text; v_rid bigint; v_perm text; v_min numeric;
begin
  select * into t from lote_tramos where id = p_tramo;
  if t.id is null then return null; end if;
  select * into l from lotes where id = t.lote_id;
  select std into v_std from lote_tareas where area = l.area and nombre = l.tarea;
  select cargo into v_cargo from operarios where dni = t.dni;
  select id into v_rid from reclamos where lote_tramo_id = t.id;
  v_perm := current_setting('app.perm', true);
  perform set_config('app.perm', '*', true);
  if t.fin is null or coalesce(t.prendas, 0) = 0 then
    if v_rid is not null then delete from reclamos where id = v_rid; end if;
  elsif v_rid is not null then
    update reclamos set cant = t.prendas, fecha = (t.inicio at time zone 'America/Lima')::date where id = v_rid;
  elsif v_std is not null and v_cargo in ('OPERARIO','ESTAJERO') then
    insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant, fecha, lote_tramo_id)
    values (null, t.dni, l.area, l.o_f, 'L-' || l.id, l.tarea, v_std, t.prendas,
            (t.inicio at time zone 'America/Lima')::date, t.id);
  end if;
  perform set_config('app.perm', coalesce(v_perm, ''), true);
  select minutos into v_min from reclamos where lote_tramo_id = t.id and estado = 'ACTIVO';
  return v_min;
end $function$;
revoke all on function public._lote_minutaje(bigint) from public, anon, authenticated;

-- Prendas ya hechas en un lote, sin contar un tramo.
create or replace function public._lote_hecho(p_lote integer, p_sin bigint)
 returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(prendas), 0)::int from lote_tramos where lote_id = p_lote and id is distinct from p_sin
$$;
revoke all on function public._lote_hecho(integer, bigint) from public, anon, authenticated;

create or replace function public._lote_tope_msg(l lotes, p_hecho integer)
 returns text language sql immutable as $$
  select 'Pasa de la cantidad del lote: van ' || p_hecho || ' de ' || l.cantidad ||
         case when l.cantidad - p_hecho > 0 then ', quedan ' || (l.cantidad - p_hecho) else ', ya está completo' end
$$;

-- ¿Puede subir tiempos de esa área? Ingeniería con Edición (o el administrador); la supervisora no.
create or replace function public._lote_tiempo_permiso(o operarios, p_area text)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(o.es_admin, false) or (o.cargo <> 'SUPERVISORA' and _lote_permiso(o, p_area, true))
$$;
revoke all on function public._lote_tiempo_permiso(operarios, text) from public, anon, authenticated;

-- ---------- Un lote con lo hecho hasta ahora (suma minutaje y queda) ----------
create or replace function public._lote_json(l lotes)
 returns json language sql stable security definer set search_path to 'public' as $$
  select json_build_object('id', l.id, 'area', l.area, 'destino', l.destino, 'tarea', l.tarea, 'cantidad', l.cantidad,
    'o_f', l.o_f, 'estado', l.estado, 'creado', l.creado, 'cerrado', l.cerrado,
    'hecho', coalesce(sum(t.prendas), 0),
    'queda', greatest(l.cantidad - coalesce(sum(t.prendas), 0), 0),
    'min', coalesce(sum(_tramo_min(t.inicio, coalesce(t.fin, now()))), 0),
    'min_hoy', coalesce(sum(_tramo_min(greatest(t.inicio, (_hoy()::timestamp at time zone 'America/Lima')), coalesce(t.fin, now())))
                         filter (where coalesce(t.fin, now()) >= (_hoy()::timestamp at time zone 'America/Lima')), 0),
    'min_contado', coalesce(sum(_tramo_min(t.inicio, t.fin)) filter (where t.prendas is not null), 0),
    'ahora', count(*) filter (where t.fin is null),
    'personas', count(distinct t.dni),
    'por_revisar', count(*) filter (where t.fin is not null and t.prendas is null and t.revisado is null),
    'std', (select k.std from lote_tareas k where k.area = l.area and k.nombre = l.tarea),
    'minutaje', (select coalesce(sum(r.minutos), 0) from reclamos r join lote_tramos x on x.id = r.lote_tramo_id
                  where x.lote_id = l.id and r.estado = 'ACTIVO'))
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
                        'min', _tramo_min(t.inicio, coalesce(t.fin, now())), 'destino', l.destino, 'tarea', l.tarea, 'area', l.area,
                        'minutaje', (select r.minutos from reclamos r where r.lote_tramo_id = t.id and r.estado = 'ACTIVO')) order by t.inicio)
                       from lote_tramos t join lotes l on l.id = t.lote_id
                      where t.dni = o.dni and (t.inicio at time zone 'America/Lima')::date = _hoy()), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Termina el lote en curso. p_prendas null = "que lo ponga mi supervisora".
-- Parche 119: no pasa de la cantidad del lote y genera el minutaje.
create or replace function public.fn_lote_terminar(p_dni text, p_token uuid, p_prendas integer)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; t lote_tramos; l lotes; v_hecho integer; v_mj numeric;
begin
  o := _auth(p_dni, p_token);
  perform pg_advisory_xact_lock(hashtext('lote:' || o.dni));
  if p_prendas is not null and (p_prendas < 0 or p_prendas > 100000) then
    return json_build_object('ok', false, 'error', 'Cantidad inválida');
  end if;
  select * into t from lote_tramos where dni = o.dni and fin is null;
  if t.id is null then
    -- Doble toque: el primero ya lo cerró. Si fue hace instantes, se toma como el mismo.
    select * into t from lote_tramos where dni = o.dni and fin > now() - interval '2 minutes' order by fin desc limit 1;
    if t.id is not null then return json_build_object('ok', true, 'repetido', true, 'min', _tramo_min(t.inicio, t.fin),
        'minutaje', (select r.minutos from reclamos r where r.lote_tramo_id = t.id and r.estado = 'ACTIVO')); end if;
    return json_build_object('ok', false, 'error', 'No tienes un lote en curso');
  end if;
  if p_prendas is not null then
    -- Bloquea el lote: dos personas terminando a la vez no pasan el tope.
    select * into l from lotes where id = t.lote_id for update;
    v_hecho := _lote_hecho(l.id, t.id);
    if v_hecho + p_prendas > l.cantidad then
      return json_build_object('ok', false, 'error', _lote_tope_msg(l, v_hecho), 'queda', greatest(l.cantidad - v_hecho, 0));
    end if;
  end if;
  update lote_tramos set fin = now(), prendas = p_prendas where id = t.id returning * into t;
  v_mj := _lote_minutaje(t.id);
  return json_build_object('ok', true, 'min', _tramo_min(t.inicio, t.fin), 'minutaje', v_mj);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- Supervisora e Ingeniería ----------
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
                  'min', _tramo_min(t.inicio, coalesce(t.fin, now())),
                  'minutaje', (select r.minutos from reclamos r where r.lote_tramo_id = t.id and r.estado = 'ACTIVO')) order by t.inicio desc)
                 from lote_tramos t left join operarios op on op.dni = t.dni where t.lote_id = l.id), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Poner la cantidad (y si hace falta la hora de fin) de un tramo por revisar.
-- Parche 119: respeta el tope del lote y genera el minutaje.
create or replace function public.fn_lote_tramo_revisar(p_dni text, p_token uuid, p_tramo bigint, p_prendas integer, p_fin text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; t lote_tramos; l lotes; v_fin timestamptz; v_hecho integer; v_mj numeric;
begin
  o := _auth(p_dni, p_token);
  select * into t from lote_tramos where id = p_tramo;
  if t.id is null or t.fin is null then return json_build_object('ok', false, 'error', 'Ese tramo sigue en curso'); end if;
  select * into l from lotes where id = t.lote_id for update;
  if not _lote_permiso(o, l.area, true) then raise exception 'NO_AUTORIZADA_AREA: no puedes revisar lotes en %', l.area; end if;
  if p_prendas is null or p_prendas < 0 then return json_build_object('ok', false, 'error', 'Pon la cantidad'); end if;
  v_hecho := _lote_hecho(l.id, t.id);
  if v_hecho + p_prendas > l.cantidad then
    return json_build_object('ok', false, 'error', _lote_tope_msg(l, v_hecho), 'queda', greatest(l.cantidad - v_hecho, 0));
  end if;
  v_fin := t.fin;
  if nullif(p_fin,'') is not null then
    v_fin := (((t.inicio at time zone 'America/Lima')::date + p_fin::time) at time zone 'America/Lima');
    if v_fin <= t.inicio then return json_build_object('ok', false, 'error', 'La hora de fin debe ser después del inicio'); end if;
  end if;
  update lote_tramos set prendas = p_prendas, fin = v_fin, revisado = now(), revisado_por = o.dni where id = t.id;
  v_mj := _lote_minutaje(t.id);
  return json_build_object('ok', true, 'minutaje', v_mj);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Corregir la cantidad de un lote (el tope). Nunca por debajo de lo ya hecho.
create or replace function public.fn_lote_cantidad(p_dni text, p_token uuid, p_lote integer, p_cantidad integer)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; l lotes; v_hecho integer;
begin
  o := _auth(p_dni, p_token);
  select * into l from lotes where id = p_lote for update;
  if l.id is null then return json_build_object('ok', false, 'error', 'No existe el lote'); end if;
  if not _lote_permiso(o, l.area, true) then raise exception 'NO_AUTORIZADA_AREA: no puedes cambiar lotes en %', l.area; end if;
  if coalesce(p_cantidad, 0) <= 0 then return json_build_object('ok', false, 'error', 'Pon la cantidad de prendas'); end if;
  v_hecho := _lote_hecho(l.id, null);
  if p_cantidad < v_hecho then
    return json_build_object('ok', false, 'error', 'Ya van ' || v_hecho || ' prendas: la cantidad no puede ser menor');
  end if;
  update lotes set cantidad = p_cantidad where id = l.id;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Panel: suma el minutaje del día por área.
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
    'areas', (select json_agg(json_build_object('area', a, 'edita', _lote_permiso(o, a, true), 'tiempos', _lote_tiempo_permiso(o, a),
        'ahora', (select count(*) from lote_tramos t join lotes l on l.id = t.lote_id where l.area = a and t.fin is null),
        'min', (select coalesce(sum(_tramo_min(greatest(t.inicio, v_ini), least(coalesce(t.fin, now()), v_fin))), 0)
                  from lote_tramos t join lotes l on l.id = t.lote_id
                 where l.area = a and t.inicio < v_fin and coalesce(t.fin, now()) > v_ini),
        'minutaje', (select coalesce(sum(r.minutos), 0) from reclamos r
                      where r.lote_tramo_id is not null and r.area = a and r.fecha = v_f and r.estado = 'ACTIVO'),
        'sin_tiempo', (select count(*) from lote_tareas k where k.area = a and k.activo and k.std is null),
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
                        'queda', l.cantidad - _lote_hecho(l.id, t.id),
                        'min', _tramo_min(t.inicio, t.fin)) order by t.inicio)
                       from lote_tramos t join lotes l on l.id = t.lote_id left join operarios op on op.dni = t.dni
                      where l.area = any(v_areas) and t.fin is not null and t.prendas is null and t.revisado is null
                        and t.inicio > now() - interval '30 days'), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- Tiempos por tarea (Ingeniería) ----------
-- Todas las tareas de las áreas que ve, con lo real de los últimos 30 días
-- como referencia y cuántos tramos con prendas se quedaron sin minutaje.
create or replace function public.fn_lote_tiempos(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_areas text[];
begin
  o := _auth(p_dni, p_token);
  select array_agg(a) into v_areas from unnest(array['DESPACHO','REPROCESO','CORTE']) a where _lote_permiso(o, a, false);
  if v_areas is null then raise exception 'NO_AUTORIZADA: sin acceso a Trabajo por tiempo'; end if;
  return json_build_object('ok', true,
    'areas', (select json_agg(json_build_object('area', a, 'edita', _lote_tiempo_permiso(o, a)) order by a) from unnest(v_areas) a),
    'tareas', coalesce((select json_agg(json_build_object('id', k.id, 'area', k.area, 'nombre', k.nombre, 'std', k.std, 'activo', k.activo,
        'actualizado', k.actualizado, 'por', coalesce(op.nombres_apellidos, k.actualizado_por),
        'prendas', z.prendas, 'min', z.min, 'personas', z.personas, 'tramos', z.tramos,
        'real', case when z.prendas > 0 then round(z.min / z.prendas, 3) end,
        'sin_minutaje', z.sin_mj) order by k.area, k.activo desc, k.id)
      from lote_tareas k
      left join operarios op on op.dni = k.actualizado_por
      left join lateral (
        select coalesce(sum(t.prendas), 0) prendas, coalesce(sum(_tramo_min(t.inicio, t.fin)), 0) min,
               count(distinct t.dni) personas, count(*) tramos,
               count(*) filter (where not exists (select 1 from reclamos r where r.lote_tramo_id = t.id)) sin_mj
          from lote_tramos t join lotes l on l.id = t.lote_id
         where l.area = k.area and l.tarea = k.nombre and t.prendas > 0 and t.fin is not null
           and t.inicio > now() - interval '30 days') z on true
      where k.area = any(v_areas)), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Guarda uno o varios tiempos: [{area, nombre, std, activo}]. std null = sin tiempo.
-- p_desde: además da minutaje a los tramos con prendas desde ese día que se
-- quedaron sin él porque la tarea no tenía tiempo (máximo 31 días atrás).
create or replace function public.fn_lote_tiempos_guardar(p_dni text, p_token uuid, p_filas json, p_desde date)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; f json; v_area text; v_nom text; v_std numeric; v_act boolean; k lote_tareas;
        v_guard int := 0; v_igual int := 0; v_apl int := 0; v_min numeric := 0; v_mj numeric; t record;
        v_cambio text[] := '{}';
begin
  o := _auth(p_dni, p_token);
  if p_filas is null or json_typeof(p_filas) <> 'array' or json_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'No hay tiempos que guardar'); end if;
  if json_array_length(p_filas) > 300 then return json_build_object('ok', false, 'error', 'Máximo 300 filas por vez'); end if;
  if p_desde is not null and p_desde < _hoy() - 31 then
    return json_build_object('ok', false, 'error', 'Solo se puede dar minutaje hasta 31 días atrás'); end if;
  perform pg_advisory_xact_lock(hashtext('lote_tiempos'));
  for f in select * from json_array_elements(p_filas) loop
    v_area := upper(trim(coalesce(f->>'area','')));
    v_nom  := upper(regexp_replace(trim(coalesce(f->>'nombre','')), '\s+', ' ', 'g'));
    v_act  := coalesce((f->>'activo')::boolean, true);
    begin
      v_std := nullif(replace(trim(coalesce(f->>'std','')), ',', '.'), '')::numeric;
    exception when others then
      return json_build_object('ok', false, 'error', 'Tiempo inválido en ' || v_nom || ': ' || coalesce(f->>'std',''));
    end;
    if v_area not in ('DESPACHO','REPROCESO','CORTE') then
      return json_build_object('ok', false, 'error', 'Área inválida: ' || v_area || ' (solo DESPACHO, REPROCESO o CORTE)'); end if;
    if not _lote_tiempo_permiso(o, v_area) then raise exception 'NO_AUTORIZADA_AREA: no puedes subir tiempos de %', v_area; end if;
    if v_nom = '' or length(v_nom) > 40 then return json_build_object('ok', false, 'error', 'Falta el nombre de la tarea (máximo 40 letras)'); end if;
    if v_std is not null and (v_std <= 0 or v_std > 600) then
      return json_build_object('ok', false, 'error', 'El tiempo de ' || v_nom || ' debe estar entre 0 y 600 min por prenda'); end if;
    v_std := round(v_std, 4);
    select * into k from lote_tareas where area = v_area and nombre = v_nom;
    if k.id is not null and k.std is not distinct from v_std and k.activo = v_act then v_igual := v_igual + 1; continue; end if;
    insert into lote_tareas (area, nombre, std, activo, actualizado, actualizado_por)
    values (v_area, v_nom, v_std, v_act, now(), o.dni)
    on conflict (area, nombre) do update set std = excluded.std, activo = excluded.activo, actualizado = now(), actualizado_por = o.dni;
    insert into lote_tareas_log (tarea_id, std_antes, std_nuevo, activo, por)
    select id, k.std, v_std, v_act, o.dni from lote_tareas where area = v_area and nombre = v_nom;
    v_guard := v_guard + 1;
    if v_std is not null then v_cambio := v_cambio || (v_area || '|' || v_nom); end if;
  end loop;

  if p_desde is not null and array_length(v_cambio, 1) > 0 then
    for t in select x.id from lote_tramos x join lotes l on l.id = x.lote_id
              where (l.area || '|' || l.tarea) = any(v_cambio) and x.prendas > 0 and x.fin is not null
                and (x.inicio at time zone 'America/Lima')::date >= p_desde
                and not exists (select 1 from reclamos r where r.lote_tramo_id = x.id)
              order by x.id loop
      v_mj := _lote_minutaje(t.id);
      if v_mj is not null then v_apl := v_apl + 1; v_min := v_min + v_mj; end if;
    end loop;
  end if;
  return json_build_object('ok', true, 'guardadas', v_guard, 'sin_cambio', v_igual, 'aplicados', v_apl, 'minutaje', round(v_min, 1));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Historial de cambios de tiempo de una tarea.
create or replace function public.fn_lote_tiempos_log(p_dni text, p_token uuid, p_tarea integer)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; k lote_tareas;
begin
  o := _auth(p_dni, p_token);
  select * into k from lote_tareas where id = p_tarea;
  if k.id is null then return json_build_object('ok', false, 'error', 'No existe la tarea'); end if;
  if not _lote_permiso(o, k.area, false) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a %', k.area; end if;
  return json_build_object('ok', true, 'filas', coalesce((select json_agg(json_build_object('antes', g.std_antes, 'nuevo', g.std_nuevo,
      'activo', g.activo, 'por', coalesce(op.nombres_apellidos, g.por), 'cuando', g.creado) order by g.creado desc)
    from lote_tareas_log g left join operarios op on op.dni = g.por where g.tarea_id = k.id), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_lote_cantidad(text, uuid, integer, integer) to anon, authenticated;
grant execute on function public.fn_lote_tiempos(text, uuid) to anon, authenticated;
grant execute on function public.fn_lote_tiempos_guardar(text, uuid, json, date) to anon, authenticated;
grant execute on function public.fn_lote_tiempos_log(text, uuid, integer) to anon, authenticated;

commit;
