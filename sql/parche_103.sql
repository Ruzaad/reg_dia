-- PARCHE 103 · Boletas sin llenar al cierre del día
-- Ver parches/PARCHE_103.md. Requiere los parches 93, 95, 98 y 101. Re-ejecutable.
-- Vuelta atrás: sql/parche_103_rollback.sql.
--
-- Mismo cálculo que fn_mi_boleta (parche 93), pero para toda un área a la vez:
--   ENTREGADO  tickets ACTIVOS ese día, o incidencias (sin HORA_EXTRA) que
--              descuentan la jornada completa (>= 575 min).
--   AUSENTE    asistencia del día que no cuenta como día activo (_ausente):
--              FALTA, DM, VACACIONES, EN DESPACHO, EN REPROCESO, EN CORTE…
--   SIN_LABOR  sábado o domingo, antes de su primer registro, o día en que su
--              área no registró ningún ticket (feriado, CORTE, REPROCESO, UDP).
--   PENDIENTE  el resto: lo que el operario ve en rojo en Mi boleta.
--
-- Quién lo ve:
--   SUPERVISORA            solo su área actual.
--   Oficina                pestaña "Boletas sin llenar" (pasoBolSin) u
--                          "Operar como › Supervisora" (pasoSupArea), y solo
--                          las áreas que lee según Permisos.
--   Administrador          todo.
-- Avisar: quien puede ver a la persona puede marcar que ya le avisó (y quitarlo).
begin;

-- ---------- 1. Avisos ----------
create table if not exists public.boletas_avisos (
  dni         text not null,          -- operario
  fecha       date not null,          -- día sin boleta
  avisado_por text not null,          -- usuario que avisó
  creado      timestamptz not null default now(),
  primary key (dni, fecha)
);
alter table public.boletas_avisos enable row level security;
revoke all on public.boletas_avisos from anon, authenticated;

-- ---------- 2. Estados por persona y día ----------
create or replace function public._boleta_estados(p_dnis text[], p_desde date, p_hasta date)
returns table(dni text, fecha date, estado text)
language sql stable security definer set search_path to 'public' set jit to off
as $$
  with o as (
    select x.dni, x.area_actual, x.area_origen from operarios x where x.dni = any(p_dnis)
  ),
  ini as (
    select z.dni, min(z.f) f from (
      -- En reclamos basta mirar 90 días atrás: recorrer toda la tabla tarda 1 s
      -- y solo importa saber si ya existía antes del rango.
      select r.dni, min(r.fecha) f from reclamos r
       where r.fecha >= p_desde - 90 and r.dni = any(p_dnis) group by r.dni
      union all select c.dni, min(c.fecha) from ocurrencias c where c.dni = any(p_dnis) group by c.dni
      union all select a.dni, min(a.fecha) from asistencia a where a.dni = any(p_dnis) group by a.dni
    ) z group by z.dni
  ),
  rec as (
    select r.dni, r.fecha from reclamos r
    where r.estado = 'ACTIVO' and r.fecha between p_desde and p_hasta and r.dni = any(p_dnis)
    group by r.dni, r.fecha
  ),
  areas_dia as (                       -- áreas que registraron algo cada día
    select r.fecha, r.area from reclamos r
    where r.estado = 'ACTIVO' and r.fecha between p_desde and p_hasta
    group by r.fecha, r.area
  ),
  oc as (
    select c.dni, c.fecha, -sum(c.minutos) m from ocurrencias c
    where c.dni = any(p_dnis) and c.fecha between p_desde and p_hasta
      and c.minutos < 0 and c.tipo <> 'HORA_EXTRA'
    group by c.dni, c.fecha
  ),
  d as (select g::date fecha from generate_series(p_desde, p_hasta, interval '1 day') g)
  select o.dni, d.fecha,
    case
      when rec.dni is not null then 'ENTREGADO'
      when coalesce(oc.m, 0) >= 575 then 'ENTREGADO'
      when _ausente(a.estado) then 'AUSENTE'
      when extract(isodow from d.fecha) >= 6 then 'SIN_LABOR'
      when d.fecha < coalesce(ini.f, _hoy()) then 'SIN_LABOR'
      when z1.area is null and z2.area is null then 'SIN_LABOR'
      else 'PENDIENTE'
    end
  from o cross join d
  left join ini on ini.dni = o.dni
  left join rec on rec.dni = o.dni and rec.fecha = d.fecha
  left join oc  on oc.dni  = o.dni and oc.fecha  = d.fecha
  left join asistencia a on a.dni = o.dni and a.fecha = d.fecha
  left join areas_dia z1 on z1.fecha = d.fecha and z1.area = o.area_actual
  left join areas_dia z2 on z2.fecha = d.fecha and z2.area = o.area_origen
$$;
revoke execute on function public._boleta_estados(text[], date, date) from public, anon, authenticated;

-- ---------- 3. Áreas que puede ver quien consulta ----------
-- p_area vacío = todas las suyas; si pide una que no lee, se niega.
create or replace function public._boletas_areas(p_dni text, p_token uuid, p_area text)
returns text[]
language plpgsql security definer set search_path to 'public'
as $$
declare o operarios; a text := nullif(trim(coalesce(p_area, '')), ''); v text[];
begin
  o := _auth(p_dni, p_token);
  if o.cargo = 'SUPERVISORA' then
    if a is not null and a <> o.area_actual then raise exception 'NO_AUTORIZADA'; end if;
    return array[o.area_actual];
  end if;
  perform _vista(p_dni, p_token, array['pasoBolSin','pasoSupArea'], null);
  if coalesce(o.es_admin, false)
     or exists (select 1 from permisos_area where dni = o.dni and area = '*') then
    select array_agg(distinct x.area_actual) into v from operarios x
     where x.estado = 'ACTIVO' and x.cargo in ('OPERARIO','ESTAJERO') and x.area_actual is not null;
  else
    select array_agg(area) into v from permisos_area where dni = o.dni and area <> '*';
  end if;
  v := coalesce(v, '{}');
  if a is not null then
    if not a = any(v) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a %', a; end if;
    return array[a];
  end if;
  return v;
end $$;
revoke execute on function public._boletas_areas(text, uuid, text) from public, anon, authenticated;

-- ---------- 4. Tablero ----------
-- Devuelve el resumen por área y, de cada persona sin boleta ese día, su
-- último ticket, sus últimos 11 días laborables y si ya se le avisó.
create or replace function public.fn_boletas_sin_llenar(
  p_dni text, p_token uuid, p_fecha date default null, p_area text default null)
returns json
language plpgsql security definer
set search_path to 'public' set statement_timeout to '30s' set jit to off
as $$
declare v_areas text[]; v_dnis text[]; v_f date; v json;
begin
  v_areas := _boletas_areas(p_dni, p_token, p_area);
  v_f := least(coalesce(p_fecha, _hoy()), _hoy());

  select array_agg(x.dni) into v_dnis from operarios x
   where x.estado = 'ACTIVO' and x.cargo in ('OPERARIO','ESTAJERO') and x.area_actual = any(v_areas);

  with t as materialized (
    select * from _boleta_estados(coalesce(v_dnis, '{}'), v_f - 20, v_f)
  ),
  dia as (
    select t.dni, t.estado, x.area_actual area, x.nombres_apellidos nombre, x.cargo
    from t join operarios x on x.dni = t.dni where t.fecha = v_f
  ),
  res as (
    select a area,
      count(d.dni) total,
      count(*) filter (where d.estado = 'PENDIENTE') pendientes,
      count(*) filter (where d.estado = 'ENTREGADO') entregados,
      count(*) filter (where d.estado = 'AUSENTE')   ausentes,
      count(*) filter (where d.estado = 'SIN_LABOR') sin_labor
    from unnest(v_areas) a left join dia d on d.area = a
    group by a
  ),
  pend as (
    select d.*,
      (select max(r.fecha) from reclamos r where r.dni = d.dni and r.estado = 'ACTIVO' and r.fecha <= v_f) ultimo,
      (select json_agg(json_build_object('f', to_char(z.fecha,'YYYY-MM-DD'), 'e', z.estado) order by z.fecha)
         from (select y.fecha, y.estado from t y
                where y.dni = d.dni and extract(isodow from y.fecha) < 6
                order by y.fecha desc limit 11) z) dias,
      (select count(*) from (select y.estado from t y where y.dni = d.dni and extract(isodow from y.fecha) < 6
                              order by y.fecha desc limit 11) z where z.estado = 'PENDIENTE') pend11,
      av.avisado_por, av.creado av_creado, ap.nombres_apellidos av_nombre
    from dia d
    left join boletas_avisos av on av.dni = d.dni and av.fecha = v_f
    left join operarios ap on ap.dni = av.avisado_por
    where d.estado = 'PENDIENTE'
  )
  select json_build_object('ok', true,
    'fecha', to_char(v_f, 'YYYY-MM-DD'), 'hoy', to_char(_hoy(), 'YYYY-MM-DD'),
    'areas', (select coalesce(json_agg(json_build_object(
        'area', area, 'total', total, 'pendientes', pendientes, 'entregados', entregados,
        'ausentes', ausentes, 'sin_labor', sin_labor) order by area), '[]'::json) from res),
    'personas', (select coalesce(json_agg(json_build_object(
        'dni', dni, 'nombre', nombre, 'area', area, 'cargo', cargo,
        'ultimo', to_char(ultimo, 'YYYY-MM-DD'), 'dias', dias,
        'pend11', pend11,
        'aviso', case when avisado_por is not null then json_build_object(
            'por', case when avisado_por ~ '^[0-9]+$' then coalesce(trim(split_part(av_nombre, ',', 1)), avisado_por) else avisado_por end,
            'hora', to_char(av_creado at time zone 'America/Lima', 'HH24:MI')) end)
      order by area, pend11 desc, nombre), '[]'::json) from pend))
  into v;
  return v;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;
revoke all on function public.fn_boletas_sin_llenar(text, uuid, date, text) from public;
grant execute on function public.fn_boletas_sin_llenar(text, uuid, date, text) to anon, authenticated;

-- ---------- 5. Marcar / quitar aviso ----------
create or replace function public.fn_boleta_avisar(
  p_dni text, p_token uuid, p_dni_op text, p_fecha date, p_quitar boolean default false)
returns json
language plpgsql security definer set search_path to 'public'
as $$
declare o operarios; v_area text;
begin
  o := _auth(p_dni, p_token);
  select area_actual into v_area from operarios where dni = p_dni_op;
  if v_area is null then return json_build_object('ok', false, 'error', 'Operario no encontrado'); end if;
  perform _boletas_areas(p_dni, p_token, v_area);    -- niega si no ve esa área
  if p_fecha is null or p_fecha > _hoy() then
    return json_build_object('ok', false, 'error', 'Fecha no válida');
  end if;
  if coalesce(p_quitar, false) then
    delete from boletas_avisos where dni = p_dni_op and fecha = p_fecha;
  else
    insert into boletas_avisos(dni, fecha, avisado_por) values (p_dni_op, p_fecha, o.dni)
    on conflict (dni, fecha) do update set avisado_por = excluded.avisado_por, creado = now();
  end if;
  return json_build_object('ok', true,
    'por', case when o.dni ~ '^[0-9]+$' then trim(split_part(o.nombres_apellidos, ',', 1)) else o.dni end,
    'hora', to_char(now() at time zone 'America/Lima', 'HH24:MI'));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;
revoke all on function public.fn_boleta_avisar(text, uuid, text, date, boolean) from public;
grant execute on function public.fn_boleta_avisar(text, uuid, text, date, boolean) to anon, authenticated;

-- ---------- 6. La pestaña nueva para quien ya opera como supervisora ----------
-- Ya veían a ese personal por "Operar como › Supervisora". ALOPEZ la puede
-- quitar o dar a otros en Gestión › Permisos.
insert into permisos_pestana(dni, pestana, asignado_por)
select distinct dni, 'pasoBolSin', 'PARCHE_103' from permisos_pestana where pestana = 'pasoSupArea'
on conflict do nothing;

commit;

-- Verificación (debe traer ok:true y las áreas de quien consulta):
-- select fn_boletas_sin_llenar('<usuario>', '<token>'::uuid, current_date - 1, null);
