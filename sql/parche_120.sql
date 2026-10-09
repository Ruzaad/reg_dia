-- PARCHE 120 — Feriados y trabajo en sábado, domingo o feriado
--
-- 1. Ingeniería marca un día completo como FERIADO (toda la planta). Ese día:
--    no se exigen los 575 min, nadie sale NO ENTREGÓ ni "por confirmar",
--    Boletas lo da por SIN_LABOR e Incentivos lo rotula FERIADO y no lo cuenta
--    en el promedio del modular (igual que un sábado).
-- 2. Regla de fin de semana, APAGADA al correr este parche: sábado y domingo
--    siguen con 575 como hoy. Cuando Ingeniería la prende desde la pantalla
--    (con la fecha en que empieza), sábado y domingo pasan a 0 min y quien
--    trabaje necesita que le pongan sus horas: entran como HORA_EXTRA
--    (detalle "JORNADA SABADO/DOMINGO/FERIADO") y son su disponible del día.
--    El feriado siempre es 0 y sus horas se ponen igual. Nada anterior a la
--    fecha de la regla cambia.
--
-- Cómo: tabla `feriados`, tres funciones chicas (_feriado, _laborable, _jornada)
-- y tres RPC nuevas. Las funciones que tenían "575" o "lunes a viernes" escritos
-- a mano se reescriben aquí mismo cambiando SOLO esos pedazos: cada cambio
-- comprueba que encontró el texto exacto (si no, aborta todo sin tocar nada) y
-- guarda la versión anterior en `parche_120_respaldo` para el deshacer.
-- No toca fn_carga_capacidad (la está corrigiendo otro hilo).
begin;

create table if not exists public.feriados (
  fecha          date primary key,
  motivo         text not null,
  registrado_por text references public.operarios(dni),
  creado         timestamptz not null default now()
);
alter table public.feriados enable row level security;   -- solo por RPC

create or replace function public._feriado(p date) returns boolean
 language sql stable as
$$ select exists (select 1 from public.feriados f where f.fecha = p) $$;

create or replace function public._laborable(p date) returns boolean
 language sql stable as
$$ select extract(isodow from p) < 6 and not exists (select 1 from public.feriados f where f.fecha = p) $$;

/* Regla de fin de semana: APAGADA al correr el parche (desde = null). Mientras
   esté apagada, sábado y domingo siguen con sus 575 como siempre. Se prende
   desde la pantalla (fn_regla_finde_guardar) con la fecha en que empieza. */
create table if not exists public.regla_finde (
  id        int primary key default 1 check (id = 1),
  desde     date,
  puesto_por text references public.operarios(dni),
  creado    timestamptz not null default now()
);
alter table public.regla_finde enable row level security;
insert into public.regla_finde (id, desde) values (1, null) on conflict (id) do nothing;

/* Jornada base del día: 575 de lunes a viernes; 0 en feriado; 0 en sábado y
   domingo solo desde que se prende la regla (antes, 575 como siempre). */
create or replace function public._jornada(p date) returns numeric
 language sql stable as
$$ select case when extract(isodow from p) < 6 and not exists (select 1 from public.feriados f where f.fecha = p) then 575
               when exists (select 1 from public.feriados f where f.fecha = p) then 0
               when exists (select 1 from public.regla_finde r where r.desde is not null and p >= r.desde) then 0
               else 575 end::numeric $$;

create table if not exists public.parche_120_respaldo (firma text primary key, def text not null, creado timestamptz default now());
alter table public.parche_120_respaldo enable row level security;

create temp table _c120 (ord serial, firma text, viejo text, nuevo text, veces int) on commit drop;
insert into _c120 (firma, viejo, nuevo, veces) values
  ('public._dias_hab(date,date)', ' IMMUTABLE', ' STABLE', 1),
  ('public._dias_hab(date,date)', 'where extract(isodow from d) < 6', 'where _laborable(d::date)', 1),

  ('public._disp_reparto(date,text)', '575::numeric efectivo,', '_jornada(p_fecha) efectivo,', 1),
  ('public._disp_reparto(date,text)', 'extract(dow from p_fecha) in (0,6) finde', 'not _laborable(p_fecha) finde', 1),

  ('public.fn_eficiencia_dia(text,uuid,date)', 'else 575 + coalesce((select m from ocu o where o.dni = g.dni),0) end disp',
                                               'else _jornada(p_fecha) + coalesce((select m from ocu o where o.dni = g.dni),0) end disp', 1),

  ('public.fn_eficiencia_rango(text,uuid,date,date,text)', 'else (case when extract(dow from dd.f) in (0,6) and pr.dni is null then 0',
                                                          'else (case when not _laborable(dd.f) and pr.dni is null then 0', 1),
  ('public.fn_eficiencia_rango(text,uuid,date,date,text)', 'else 575 end) + coalesce(oc.m,0) end disp',
                                                          'else _jornada(dd.f) end) + coalesce(oc.m,0) end disp', 1),

  ('public.fn_resumen_operario(text,uuid,date,date,text)', 'else (case when extract(dow from dd.f) in (0,6) and pd.dni is null then 0 else 575 end)',
                                                          'else (case when not _laborable(dd.f) and pd.dni is null then 0 else _jornada(dd.f) end)', 1),

  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', 'extract(isodow from d)::int idow,',
                                                             'extract(isodow from d)::int idow, _laborable(d::date) lab, _feriado(d::date) fer,', 1),
  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', 'from dias where idow <= 5) z', 'from dias where lab) z', 1),
  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', 'd.f, d.idow, d.lunes,', 'd.f, d.idow, d.lab, d.fer, d.lunes,', 1),
  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', '575 + coalesce(o.mins,0) disp,', '_jornada(d.f) + coalesce(o.mins,0) disp,', 1),
  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', 'when c.idow = 6 then ''SABADO''', 'when c.fer then ''FERIADO'' when c.idow = 6 then ''SABADO''', 1),
  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', 'case when c.idow <= 5 and not _ausente', 'case when c.lab and not _ausente', 1),
  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', 'where p.idow <= 5', 'where p.lab', 1),
  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', 'from eval where idow <= 5 group by 1', 'from eval where lab group by 1', 1),
  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', 'where e.idow <= 5 and e.ef is not null', 'where e.lab and e.ef is not null', 1),
  ('public.fn_incentivos_quincena(text,uuid,date,date,text)', '''laborable'', idow <= 5,', '''laborable'', lab, ''feriado'', fer,', 1),

  ('public.fn_mi_boleta(text,uuid,date,date)', 'when extract(isodow from d.fecha) >= 6 then ''SIN_LABOR''', 'when not _laborable(d.fecha) then ''SIN_LABOR''', 1),
  ('public._boleta_estados(text[],date,date)', 'when extract(isodow from d.fecha) >= 6 then ''SIN_LABOR''', 'when not _laborable(d.fecha) then ''SIN_LABOR''', 1),
  ('public.fn_boletas_sin_llenar(text,uuid,date,text)', 'extract(isodow from y.fecha) < 6', '_laborable(y.fecha)', 2),
  ('public.fn_asistencia_por_confirmar(text,uuid,date,date)', 'extract(isodow from d) < 6', '_laborable(d::date)', 2),
  ('public.fn_asistencia_areas(text,uuid,date,date)', 'extract(dow from d) not in (0,6)', '_laborable(d::date)', 1),
  ('public.fn_asistencia_dashboard(text,uuid,text,date,date)', 'extract(dow from d) not in (0,6)', '_laborable(d::date)', 3),
  ('public.fn_asistencia_dashboard(text,uuid,text,date,date)', 'if extract(dow from hoy) not in (0,6) then', 'if _laborable(hoy) then', 1),
  ('public.fn_asistencia_marcar_lista(text,uuid,text,date)', '''por_ticket'', (z.tickets > 0))', '''por_ticket'', (z.tickets > 0), ''feriado'', _feriado(v_fecha))', 1),
  ('public.fn_asistencia_marcar_lista(text,uuid,text,date)', '''fecha'', to_char(v_fecha,''YYYY-MM-DD''), ''personal'', v',
                                                            '''fecha'', to_char(v_fecha,''YYYY-MM-DD''), ''feriado'', (select f.motivo from feriados f where f.fecha = v_fecha), ''personal'', v', 1),

  ('public.fn_mi_dia(text,uuid)', 'select 575 + coalesce(sum(minutos),0) into disp', 'select _jornada(_hoy()) + coalesce(sum(minutos),0) into disp', 1),
  ('public.fn_personal(text,uuid,text)', 'else 575 + coalesce((select sum(x.minutos) from ocurrencias x', 'else _jornada(_hoy()) + coalesce((select sum(x.minutos) from ocurrencias x', 1),

  ('public.fn_ef_auditoria_v2(text,uuid,date,date,text,numeric,numeric)', '575 + coalesce(oc.m,0) disp', '_jornada(p.fecha) + coalesce(oc.m,0) disp', 1),
  ('public.fn_ef_auditoria_v2(text,uuid,date,date,text,numeric,numeric)', 'round(b.prod / 575.0 * 100, 1)', 'round(b.prod / nullif(_jornada(b.fecha),0) * 100, 1)', 1),
  ('public.fn_ef_auditoria_detalle(text,uuid,text,date)', '''disp'', round(575 + v_min,0)', '''disp'', round(_jornada(p_fecha) + v_min,0)', 1),
  ('public.fn_ef_auditoria_ops(text,uuid,text,date)', 'round(avg(d.prod / (575 + coalesce(o.m,0)) * 100), 1)', 'round(avg(d.prod / (_jornada(d.fecha) + coalesce(o.m,0)) * 100), 1)', 1),
  ('public.fn_ef_auditoria_ops(text,uuid,text,date)', 'where 575 + coalesce(o.m,0) > 0;', 'where _jornada(d.fecha) + coalesce(o.m,0) > 0;', 1),
  ('public.fn_ef_auditoria_ops(text,uuid,text,date)', '(575 + coalesce(c.m,0)) * o.m / t.tot / o.cant t_real', '(_jornada(o.fecha) + coalesce(c.m,0)) * o.m / t.tot / o.cant t_real', 1),
  ('public.fn_ef_auditoria_ops(text,uuid,text,date)', 'and 575 + coalesce(c.m,0) > 0', 'and _jornada(o.fecha) + coalesce(c.m,0) > 0', 1),
  ('public.fn_ef_auditoria_ops(text,uuid,text,date)', '''disp'', round(575 + v_min,0),', '''disp'', round(_jornada(p_fecha) + v_min,0),', 1),
  ('public.fn_ef_auditoria_ops(text,uuid,text,date)', '''ef'', case when 575 + v_min > 0 then round(v_prod / (575 + v_min) * 100, 1) end,',
                                                      '''ef'', case when _jornada(p_fecha) + v_min > 0 then round(v_prod / (_jornada(p_fecha) + v_min) * 100, 1) end,', 1),
  ('public.fn_ef_tickets_rango(text,uuid,text,date,date)', 'round(b.prod / (575 + coalesce(o.mins,0)) * 100, 1)', 'round(b.prod / (_jornada(b.fecha) + coalesce(o.mins,0)) * 100, 1)', 1),
  ('public.fn_ef_tickets_rango(text,uuid,text,date,date)', 'where (575 + coalesce(o.mins,0)) > 0;', 'where (_jornada(b.fecha) + coalesce(o.mins,0)) > 0;', 1),
  ('public.fn_ef_manual_listar(text,uuid,text,date,date)', '575 + coalesce(o.mins,0) disp,', '_jornada(m.fecha) + coalesce(o.mins,0) disp,', 1);

do $p$
declare f text; c record; d text; n int;
begin
  for f in select firma from _c120 group by firma order by min(ord) loop
    if exists (select 1 from public.parche_120_respaldo where firma = f) then
      raise notice 'parche 120: % ya estaba aplicado, se deja igual', f; continue;
    end if;
    d := pg_get_functiondef(f::regprocedure);
    insert into public.parche_120_respaldo (firma, def) values (f, d);
    for c in select * from _c120 where firma = f order by ord loop
      n := (length(d) - length(replace(d, c.viejo, ''))) / length(c.viejo);
      if n <> c.veces then
        raise exception 'parche 120: en % se esperaba % vez(ces) "%" y hay %. No se aplicó nada.', f, c.veces, c.viejo, n;
      end if;
      d := replace(d, c.viejo, c.nuevo);
    end loop;
    execute d;
  end loop;
end $p$;

/* ---------- RPC nuevas ---------- */

-- Marcar o quitar un feriado (toda la planta). Solo quien edita todas las áreas.
create or replace function public.fn_feriado_guardar(p_dni text, p_token uuid, p_fecha date, p_motivo text, p_quitar boolean default false)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_n int := 0;
begin
  o := _ing(p_dni, p_token);
  perform _vista_area(o, array['*'], true);
  perform _perm_set(o);
  if p_fecha is null then return json_build_object('ok', false, 'error', 'Elige la fecha'); end if;
  if p_fecha < _hoy() - 62 or p_fecha > _hoy() + 366 then
    return json_build_object('ok', false, 'error', 'Solo fechas de los últimos dos meses o del próximo año');
  end if;
  if coalesce(p_quitar, false) then
    -- Las horas puestas por ser feriado ya no aplican: el día vuelve a tener sus 575.
    delete from ocurrencias where fecha = p_fecha and tipo = 'HORA_EXTRA' and detalle = 'JORNADA FERIADO';
    get diagnostics v_n = row_count;
    delete from feriados where fecha = p_fecha;
    return json_build_object('ok', true, 'quitado', true, 'horas_borradas', v_n);
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    return json_build_object('ok', false, 'error', 'Escribe el motivo, por ejemplo: Combate de Angamos');
  end if;
  insert into feriados (fecha, motivo, registrado_por) values (p_fecha, trim(p_motivo), o.dni)
  on conflict (fecha) do update set motivo = excluded.motivo, registrado_por = excluded.registrado_por, creado = now();
  return json_build_object('ok', true, 'fecha', to_char(p_fecha, 'YYYY-MM-DD'),
    'trabajaron', (select count(distinct r.dni) from reclamos r where r.fecha = p_fecha and r.estado = 'ACTIVO'));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Prender (con la fecha de inicio) o apagar (null) la regla de fin de semana.
-- Solo quien edita todas las áreas. No puede empezar antes de hoy - 7.
create or replace function public.fn_regla_finde_guardar(p_dni text, p_token uuid, p_desde date)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_n int := 0;
begin
  o := _ing(p_dni, p_token);
  perform _vista_area(o, array['*'], true);
  if p_desde is not null and p_desde < _hoy() - 7 then
    return json_build_object('ok', false, 'error', 'La regla no puede empezar antes del ' || to_char(_hoy() - 7, 'DD/MM') || ': cambiaría fines de semana ya cerrados');
  end if;
  perform _perm_set(o);
  update regla_finde set desde = p_desde, puesto_por = o.dni, creado = now() where id = 1;
  -- Los fines de semana que vuelven a tener 575 no pueden quedar además con sus horas.
  delete from ocurrencias where tipo = 'HORA_EXTRA' and detalle in ('JORNADA SABADO','JORNADA DOMINGO') and _jornada(fecha) > 0;
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'desde', to_char(p_desde, 'YYYY-MM-DD'), 'horas_borradas', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Horas trabajadas en sábado, domingo o feriado: una HORA_EXTRA por persona.
-- Volver a guardar reemplaza; 0 minutos las quita.
create or replace function public.fn_jornada_horas_guardar(p_dni text, p_token uuid, p_fecha date, p_minutos numeric, p_dnis text[])
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; d text; v_nom text; v_area text; v_det text; n int := 0; v_omit text[] := '{}';
begin
  o := _ing(p_dni, p_token);
  perform _perm_set(o);
  if p_fecha is null or p_fecha < _hoy() - 62 or p_fecha > _hoy() + 7 then
    return json_build_object('ok', false, 'error', 'Solo días de los últimos dos meses o de la próxima semana');
  end if;
  if _jornada(p_fecha) > 0 then
    return json_build_object('ok', false, 'error', 'Ese día ya tiene su jornada de 575 min (día hábil, o fin de semana con la regla apagada). Si alguien se quedó más, va como hora extra en Incidencias.');
  end if;
  if p_minutos is null or p_minutos < 0 or p_minutos > 720 then
    return json_build_object('ok', false, 'error', 'Las horas van de 0 a 12 por persona');
  end if;
  if coalesce(array_length(p_dnis, 1), 0) = 0 then
    return json_build_object('ok', false, 'error', 'Elige al menos a una persona');
  end if;
  v_det := 'JORNADA ' || case when _feriado(p_fecha) then 'FERIADO'
                              when extract(isodow from p_fecha) = 6 then 'SABADO' else 'DOMINGO' end;
  perform pg_advisory_xact_lock(hashtext('fn_jornada_horas_guardar:' || p_fecha));

  foreach d in array (select array_agg(distinct x) from unnest(p_dnis) x) loop
    v_nom := null;
    select x.nombres_apellidos,
           coalesce((select r.area from reclamos r
                      where r.dni = x.dni and r.fecha = p_fecha and r.estado = 'ACTIVO' and r.area is not null
                      group by r.area order by sum(r.minutos) desc limit 1), x.area_actual)
      into v_nom, v_area
      from operarios x where x.dni = d and x.estado = 'ACTIVO' and x.cargo in ('OPERARIO','ESTAJERO');
    if v_nom is null then v_omit := v_omit || (d || ' (no está activo)'); continue; end if;
    if not (coalesce(o.es_admin, false) or exists (select 1 from permisos_area pa
             where pa.dni = o.dni and pa.nivel = 'EDITAR' and (pa.area = '*' or pa.area = v_area))) then
      v_omit := v_omit || (v_nom || ' (solo lectura en ' || v_area || ')'); continue;
    end if;
    delete from ocurrencias where dni = d and fecha = p_fecha and tipo = 'HORA_EXTRA' and detalle like 'JORNADA %';
    if p_minutos > 0 then
      insert into ocurrencias (dni, area, tipo, minutos, detalle, supervisora_dni, fecha)
      values (d, v_area, 'HORA_EXTRA', p_minutos, v_det, o.dni, p_fecha);
    end if;
    n := n + 1;
  end loop;

  if n = 0 then
    return json_build_object('ok', false, 'omitidos', to_json(v_omit), 'error', 'No se guardó a nadie: ' || array_to_string(v_omit, ', '));
  end if;
  return json_build_object('ok', true, 'afectados', n, 'omitidos', to_json(v_omit));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Lectura: feriados del rango y, por cada sábado, domingo o feriado con gente
-- que registró tickets (o con horas puestas), quién fue y cuántas horas tiene.
-- Respeta las áreas de Permisos.
create or replace function public.fn_dias_no_laborables(p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json language plpgsql stable security definer set search_path to 'public' set statement_timeout to '20s'
as $function$
declare o operarios; v_dias json; v_fer json;
begin
  o := _auth(p_dni, p_token);
  if o.cargo in ('OPERARIO','ESTAJERO','SUPERVISORA') then raise exception 'NO_AUTORIZADA'; end if;
  if p_hasta < p_desde or (p_hasta - p_desde) > 92 then
    return json_build_object('ok', false, 'error', 'Rango inválido (máximo 92 días)');
  end if;
  with dias as (
    select g::date f from generate_series(p_desde, p_hasta, interval '1 day') g where not _laborable(g::date)
  ), tk as (
    select r.fecha, r.dni, r.area, sum(r.minutos) m, count(*) n
      from reclamos r join dias on dias.f = r.fecha where r.estado = 'ACTIVO' group by 1,2,3
  ), tkp as (
    select fecha, dni, sum(m) m, sum(n) n, (array_agg(area order by m desc))[1] area from tk group by 1,2
  ), jo as (
    select oc.fecha, oc.dni, sum(oc.minutos) m, max(oc.area) area
      from ocurrencias oc join dias on dias.f = oc.fecha
     where oc.tipo = 'HORA_EXTRA' and oc.detalle like 'JORNADA %' group by 1,2
  ), gente as (
    select coalesce(t.fecha, j.fecha) fecha, coalesce(t.dni, j.dni) dni,
           coalesce(t.area, j.area) area, coalesce(t.m, 0) min_tk, coalesce(t.n, 0) tk, coalesce(j.m, 0) horas_min
      from tkp t full join jo j on j.fecha = t.fecha and j.dni = t.dni
  ), mias as (
    select g.*, x.nombres_apellidos nombre from gente g join operarios x on x.dni = g.dni
     where coalesce(o.es_admin, false)
        or exists (select 1 from permisos_area pa where pa.dni = o.dni and (pa.area = '*' or pa.area = g.area))
  )
  select coalesce(json_agg(json_build_object(
      'fecha', to_char(d.f, 'YYYY-MM-DD'),
      'tipo', case when fe.fecha is not null then 'FERIADO' when extract(isodow from d.f) = 6 then 'SABADO' else 'DOMINGO' end,
      'motivo', fe.motivo,
      'jornada', _jornada(d.f),
      'personas', coalesce((select json_agg(json_build_object(
            'dni', m.dni, 'nombre', m.nombre, 'area', m.area, 'min_tk', round(m.min_tk, 1),
            'tk', m.tk, 'horas_min', m.horas_min) order by m.area, m.nombre)
          from mias m where m.fecha = d.f), '[]'::json))
      order by d.f desc), '[]'::json)
    into v_dias
    from dias d left join feriados fe on fe.fecha = d.f
   where fe.fecha is not null or exists (select 1 from mias m where m.fecha = d.f);

  select coalesce(json_agg(json_build_object('fecha', to_char(f.fecha, 'YYYY-MM-DD'), 'motivo', f.motivo,
           'por', coalesce(trim(split_part(x.nombres_apellidos, ',', 1)), f.registrado_por),
           'creado', to_char(f.creado at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI')) order by f.fecha), '[]'::json)
    into v_fer
    from feriados f left join operarios x on x.dni = f.registrado_por
   where f.fecha >= _hoy() - 62;

  return json_build_object('ok', true, 'hoy', to_char(_hoy(), 'YYYY-MM-DD'),
    'regla_desde', (select to_char(r.desde, 'YYYY-MM-DD') from regla_finde r where r.id = 1), 'dias', v_dias, 'feriados', v_fer,
    'puede_feriado', coalesce(o.es_admin, false) or exists (select 1 from permisos_area pa where pa.dni = o.dni and pa.area = '*' and pa.nivel = 'EDITAR'));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_regla_finde_guardar(text, uuid, date) to anon, authenticated;
grant execute on function public.fn_feriado_guardar(text, uuid, date, text, boolean) to anon, authenticated;
grant execute on function public.fn_jornada_horas_guardar(text, uuid, date, numeric, text[]) to anon, authenticated;
grant execute on function public.fn_dias_no_laborables(text, uuid, date, date) to anon, authenticated;

commit;
