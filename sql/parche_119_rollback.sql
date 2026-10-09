-- ROLLBACK PARCHE 119 — vuelve a como dejó el parche 116.
-- Borra el minutaje que generaron los lotes (los reclamos con lote_tramo_id),
-- el historial de tiempos y las funciones nuevas. Los tiempos subidos se
-- quedan en lote_tareas.std (el 116 ya tenía esa columna).
begin;
delete from public.reclamos where lote_tramo_id is not null;

create or replace function public._reclamo_mueve_area()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_prev text; v_nom text; v_motivo text; v_hora time; v_ts timestamptz; v_ult timestamptz;
begin
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

drop function if exists public.fn_lote_cantidad(text, uuid, integer, integer);
drop function if exists public.fn_lote_tiempos(text, uuid);
drop function if exists public.fn_lote_tiempos_guardar(text, uuid, json, date);
drop function if exists public.fn_lote_tiempos_log(text, uuid, integer);
drop function if exists public._lote_minutaje(bigint);
drop function if exists public._lote_hecho(integer, bigint);
drop function if exists public._lote_tope_msg(lotes, integer);
drop function if exists public._lote_tiempo_permiso(operarios, text);
drop index if exists public.reclamos_lote_tramo;
alter table public.reclamos drop column if exists lote_tramo_id;
drop table if exists public.lote_tareas_log;
alter table public.lote_tareas drop column if exists actualizado;
alter table public.lote_tareas drop column if exists actualizado_por;

commit;
