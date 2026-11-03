-- PARCHE 163 — Optimización (hilo maestro, 3-nov-2026)
-- Ninguna RPC cambia de nombre, parámetros ni respuesta. Detalle en parches/PARCHE_163.md.
--   A. fn_ofs_area lee un conteo por OF guardado (of_area_conteo) en vez de contar
--      ~95 mil tickets y ~89 mil reclamos en cada llamada.
--   B. Limpieza automática (autovacuum) más frecuente en reclamos y tickets_cache.
--   C. tickets_cambios_det guarda solo las columnas de reclamos que se leen.
--   D. _sueltos (Paquetes sueltos) se planifica con los valores reales.
--   E. _boleta_estados y fn_boletas_sin_llenar sin recorridos repetidos.
--   F. fn_dias_no_laborables solo lee reclamos y ocurrencias del rango pedido.
--   G. Editar bases: no reescribe tickets ni reclamos que no cambiaron.
-- Correr fuera de hora punta: la carga inicial del conteo bloquea por unos
-- segundos los registros nuevos (no los pierde: esperan).

begin;

-- Respaldo de las versiones actuales para el deshacer.
create table if not exists parche_163_respaldo (firma text primary key, def text not null);
alter table parche_163_respaldo enable row level security;
insert into parche_163_respaldo (firma, def)
select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p
 where p.oid in ('public.fn_ofs_area(text,uuid,text)'::regprocedure,
                 'public._tickets_cambio_trg()'::regprocedure,
                 'public._sueltos(text[],text)'::regprocedure,
                 'public._boleta_estados(text[],date,date)'::regprocedure,
                 'public.fn_boletas_sin_llenar(text,uuid,date,text)'::regprocedure,
                 'public.fn_dias_no_laborables(text,uuid,date,date)'::regprocedure,
                 'public.fn_tickets_cache_refrescar(text,text)'::regprocedure,
                 'public._sync_reclamos_articulo(text,text)'::regprocedure)
on conflict (firma) do nothing;

-- ===================== A. Conteo por OF para fn_ofs_area =====================
create table if not exists of_area_conteo (
  area text not null,
  o_f text not null,
  articulo text,
  total int not null default 0,        -- tickets en tickets_cache
  reclamados int not null default 0,   -- reclamos ACTIVO con código
  primary key (area, o_f)
) with (fillfactor = 70);
alter table of_area_conteo enable row level security;
revoke all on of_area_conteo from anon, authenticated;

create or replace function _oac_tc_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into of_area_conteo as c (area, o_f, articulo, total)
  select area, o_f, max(articulo), count(*) from nt where o_f is not null
   group by 1, 2 order by 1, 2
  on conflict (area, o_f) do update
     set total = c.total + excluded.total,
         articulo = case when c.total <= 0 then excluded.articulo
                         else greatest(c.articulo, excluded.articulo) end;
  return null;
end $$;

create or replace function _oac_tc_del() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update of_area_conteo c set total = c.total - d.n
    from (select area, o_f, count(*) n from ot where o_f is not null group by 1, 2 order by 1, 2) d
   where c.area = d.area and c.o_f = d.o_f;
  return null;
end $$;

create or replace function _oac_tc_upd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update of_area_conteo c set total = c.total - d.n
    from (select o.area, o.o_f, count(*) n from ot o join nt x using (area, codigo)
           where o.o_f is not null and o.o_f is distinct from x.o_f group by 1, 2 order by 1, 2) d
   where c.area = d.area and c.o_f = d.o_f;
  insert into of_area_conteo as c (area, o_f, articulo, total)
  select x.area, x.o_f, max(x.articulo), count(*) from nt x join ot o using (area, codigo)
   where x.o_f is not null and x.o_f is distinct from o.o_f group by 1, 2 order by 1, 2
  on conflict (area, o_f) do update
     set total = c.total + excluded.total,
         articulo = case when c.total <= 0 then excluded.articulo
                         else greatest(c.articulo, excluded.articulo) end;
  -- Mismo OF con otro artículo (se corrigió la OF): se toma el nuevo.
  update of_area_conteo c set articulo = d.articulo
    from (select x.area, x.o_f, max(x.articulo) articulo from nt x join ot o using (area, codigo)
           where x.o_f is not null and x.o_f = o.o_f and x.articulo is distinct from o.articulo
           group by 1, 2 order by 1, 2) d
   where c.area = d.area and c.o_f = d.o_f;
  return null;
end $$;

create or replace function _oac_rc_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into of_area_conteo as c (area, o_f, reclamados)
  select area, o_f, count(*) from nt
   where estado = 'ACTIVO' and codigo is not null and o_f is not null
   group by 1, 2 order by 1, 2
  on conflict (area, o_f) do update set reclamados = c.reclamados + excluded.reclamados;
  return null;
end $$;

create or replace function _oac_rc_del() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update of_area_conteo c set reclamados = c.reclamados - d.n
    from (select area, o_f, count(*) n from ot
           where estado = 'ACTIVO' and codigo is not null and o_f is not null
           group by 1, 2 order by 1, 2) d
   where c.area = d.area and c.o_f = d.o_f;
  return null;
end $$;

-- Solo toca el conteo cuando cambia de verdad (anular, liberar, mover de OF).
-- Las actualizaciones de nop/std/modulo no lo tocan ni lo bloquean.
create or replace function _oac_rc_upd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into of_area_conteo as c (area, o_f, reclamados)
  select area, o_f, sum(d)::int from (
    select area, o_f, 1 d from nt where estado = 'ACTIVO' and codigo is not null and o_f is not null
    union all
    select area, o_f, -1 from ot where estado = 'ACTIVO' and codigo is not null and o_f is not null
  ) x group by 1, 2 having sum(d) <> 0 order by 1, 2
  on conflict (area, o_f) do update set reclamados = c.reclamados + excluded.reclamados;
  return null;
end $$;

drop trigger if exists oac_tc_ins on tickets_cache;
drop trigger if exists oac_tc_del on tickets_cache;
drop trigger if exists oac_tc_upd on tickets_cache;
create trigger oac_tc_ins after insert on tickets_cache referencing new table as nt
  for each statement execute function _oac_tc_ins();
create trigger oac_tc_del after delete on tickets_cache referencing old table as ot
  for each statement execute function _oac_tc_del();
create trigger oac_tc_upd after update on tickets_cache referencing old table as ot new table as nt
  for each statement execute function _oac_tc_upd();

drop trigger if exists oac_rc_ins on reclamos;
drop trigger if exists oac_rc_del on reclamos;
drop trigger if exists oac_rc_upd on reclamos;
create trigger oac_rc_ins after insert on reclamos referencing new table as nt
  for each statement execute function _oac_rc_ins();
create trigger oac_rc_del after delete on reclamos referencing old table as ot
  for each statement execute function _oac_rc_del();
create trigger oac_rc_upd after update on reclamos referencing old table as ot new table as nt
  for each statement execute function _oac_rc_upd();

-- Recalcula el conteo desde cero (lo usa este parche y sirve si alguna vez se duda).
create or replace function _oac_recalcular() returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  lock table tickets_cache, reclamos in share mode;
  delete from of_area_conteo;
  insert into of_area_conteo (area, o_f, articulo, total, reclamados)
  select coalesce(t.area, r.area), coalesce(t.o_f, r.o_f), t.articulo, coalesce(t.n, 0), coalesce(r.n, 0)
    from (select area, o_f, max(articulo) articulo, count(*) n from tickets_cache
           where o_f is not null group by 1, 2) t
    full join (select area, o_f, count(*) n from reclamos
                where estado = 'ACTIVO' and codigo is not null and o_f is not null group by 1, 2) r
      on r.area = t.area and r.o_f = t.o_f;
  get diagnostics v = row_count;
  return v;
end $$;
revoke all on function _oac_recalcular() from public, anon, authenticated;

select _oac_recalcular();

create or replace function public.fn_ofs_area(p_dni text, p_token uuid, p_area text)
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '30s'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return coalesce((
    select json_agg(json_build_object(
        'of', c.o_f, 'articulo', c.articulo,
        'total', c.total, 'libres', greatest(c.total - c.reclamados, 0)) order by c.o_f)
      from of_area_conteo c
     where c.area = p_area and c.total > 0), '[]'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ===================== B. Limpieza automática más seguida =====================
alter table reclamos set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02,
                          autovacuum_vacuum_insert_scale_factor = 0.02);
alter table tickets_cache set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02,
                               autovacuum_vacuum_insert_scale_factor = 0.02);
alter table of_area_conteo set (autovacuum_vacuum_scale_factor = 0.05);

-- ===================== C. tickets_cambios_det más liviano =====================
-- Guarda de reclamos solo las columnas que leen el deshacer, el detalle del
-- cambio y la ficha del paquete. Residuales sigue completo (es chico).
create or replace function _tc_ficha(p_tabla text, j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null or p_tabla <> 'reclamos' then j
    else jsonb_build_object(
      'id', j->'id', 'area', j->'area', 'codigo', j->'codigo', 'dni', j->'dni',
      'o_f', j->'o_f', 'op', j->'op', 'numeracion', j->'numeracion',
      'cant', j->'cant', 'minutos', j->'minutos', 'fecha', j->'fecha', 'estado', j->'estado',
      'cant_asignada', j->'cant_asignada', 'motivo_fecha', j->'motivo_fecha',
      'motivo_liberacion', j->'motivo_liberacion') end
$$;

create or replace function public._tickets_cambio_trg()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare c bigint := nullif(current_setting('app.cambio', true), '')::bigint;
        a jsonb; d jsonb; r jsonb;
begin
  if c is null then return null; end if;
  if tg_op <> 'INSERT' then a := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then d := to_jsonb(new); end if;
  if a = d then return null; end if;
  r := coalesce(d, a);
  insert into tickets_cambios_det (cambio_id, tabla, op, fila, antes, despues)
  values (c, tg_table_name, left(tg_op, 1),
          case tg_table_name when 'reclamos' then r->>'id' else (r->>'area') || '|' || (r->>'codigo') end,
          _tc_ficha(tg_table_name, a), _tc_ficha(tg_table_name, d));
  return null;
end $function$;

-- ===================== D. Paquetes sueltos =====================
-- Misma consulta, pero armada con los valores reales: antes se planificaba con
-- "p_areas is null or ..." y recorría tickets_cache entera. Tampoco toca ACABADO.
create or replace function public._sueltos(p_areas text[], p_of text)
 returns table(area text, o_f text, articulo text, modulo text, op text, n_op integer, paq integer,
               minutos numeric, motivo text, liberado boolean, parada boolean, ult date, salto date)
 language plpgsql stable security definer
 set search_path to 'public' set work_mem to '16MB'
as $function$
declare
  v_ar text := case when p_areas is null then '' else format(' and r.area = any(%L::text[])', p_areas) end;
  v_or text := case when p_of is null then '' else format(' and r.o_f = %L', p_of) end;
  v_at text := case when p_areas is null then '' else format(' and t.area = any(%L::text[])', p_areas) end;
  v_ot text := case when p_of is null then '' else format(' and t.o_f = %L', p_of) end;
begin
  return query execute format($q$
  with hoy as (select _hoy() h),
  lim as (
    select max(x::date) filter (where _dias_hab(x::date, h) >= 7) l7,
           max(x::date) filter (where _dias_hab(x::date, h) >= 3) l3
      from hoy, generate_series(h - 30, h, interval '1 day') x
  ),
  ofa as (
    select r.area, r.o_f from reclamos r
     where r.estado = 'ACTIVO' and r.area <> 'ACABADO' %1$s %2$s
     group by 1, 2 having max(r.fecha) >= _hoy() - 120
  ),
  ra as (
    select r.area, r.codigo, r.fecha from reclamos r
     where r.estado = 'ACTIVO' and r.area <> 'ACABADO' %1$s %2$s
  ),
  t as (
    select t.area, t.o_f, t.articulo, t.modulo, t.op, t.n_op, t.paq, t.codigo, t.std * t.cant mi, r.fecha,
           max(r.fecha) over (partition by t.area, t.o_f) ult,
           count(r.fecha) over (partition by t.area, t.o_f, t.n_op) hechos,
           min(r.fecha) over (partition by t.area, t.o_f, t.n_op order by t.paq desc
                              rows between unbounded preceding and 1 preceding) salto
      from tickets_cache t
      join ofa a on a.area = t.area and a.o_f = t.o_f
      left join ra r on r.area = t.area and r.codigo = t.codigo
     where t.area <> 'ACABADO' %3$s %4$s
       and not exists (select 1 from modulos_cerrados m where m.area = t.area and m.o_f = t.o_f and m.modulo = t.modulo)
  ),
  viva as (
    select coalesce(jsonb_object_agg(k, true), '{}') j from (
      select distinct r.area || '|' || r.op k from reclamos r, hoy
       where r.estado = 'ACTIVO' and r.fecha >= hoy.h - 60 %1$s) z where k is not null
  ),
  lib as (
    select coalesce(jsonb_object_agg(k, true), '{}') j from (
      select distinct r.area || '|' || r.codigo k from reclamos r
       where r.estado = 'LIBERADO' %1$s %2$s) z where k is not null
  ),
  l as materialized (
    select t.*, t.ult <= (select l7 from lim) parada
      from t where t.fecha is null
       and (t.ult <= (select l7 from lim) or t.salto <= (select l3 from lim))
  )
  select l.area, l.o_f, l.articulo, l.modulo, l.op, l.n_op, l.paq, round(l.mi, 1) minutos,
         case when l.salto is not null or l.hechos > 0 then 'SALTADO'
              when (select j from viva) ? (l.area || '|' || l.op) then 'SIN_REGISTRAR'
              else 'NADIE' end motivo,
         (select j from lib) ? (l.area || '|' || l.codigo) liberado, l.parada, l.ult, l.salto
    from l
  $q$, v_ar, v_or, v_at, v_ot);
end $function$;

-- ===================== E. Boletas sin llenar =====================
-- "Desde cuándo existe" busca el primer reclamo de cada persona por índice (antes
-- recorría ~225 mil filas). Se planifica con los valores reales (EXECUTE).
create or replace function public._boleta_estados(p_dnis text[], p_desde date, p_hasta date)
 returns table(dni text, fecha date, estado text)
 language plpgsql stable security definer
 set search_path to 'public' set jit to 'off'
as $function$
begin
  return query execute $q$
  with o as (
    select x.dni, x.area_actual, x.area_origen from operarios x where x.dni = any($1)
  ),
  ini as (
    select z.dni, min(z.f) f from (
      select o.dni, (select r.fecha from reclamos r
                      where r.dni = o.dni and r.fecha >= $2 - 90 order by r.fecha limit 1) f from o
      union all select c.dni, min(c.fecha) from ocurrencias c where c.dni = any($1) group by c.dni
      union all select a.dni, min(a.fecha) from asistencia a where a.dni = any($1) group by a.dni
    ) z group by z.dni
  ),
  rec as (
    select r.dni, r.fecha from reclamos r
    where r.estado = 'ACTIVO' and r.fecha between $2 and $3 and r.dni = any($1)
    group by r.dni, r.fecha
  ),
  areas_dia as (
    select r.fecha, r.area from reclamos r
    where r.estado = 'ACTIVO' and r.fecha between $2 and $3
    group by r.fecha, r.area
  ),
  oc as (
    select c.dni, c.fecha, -sum(c.minutos) m from ocurrencias c
    where c.dni = any($1) and c.fecha between $2 and $3
      and c.minutos < 0 and c.tipo <> 'HORA_EXTRA'
    group by c.dni, c.fecha
  ),
  d as (select g::date fecha, _laborable(g::date) lab, _jornada(g::date) jor
          from generate_series($2, $3, interval '1 day') g)
  select o.dni, d.fecha,
    case
      when rec.dni is not null then 'ENTREGADO'
      when d.jor > 0 and coalesce(oc.m, 0) >= d.jor then 'ENTREGADO'
      when _ausente(a.estado) then 'AUSENTE'
      when not d.lab then 'SIN_LABOR'
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
  $q$ using p_dnis, p_desde, p_hasta;
end $function$;

-- Los 11 últimos días laborables de cada pendiente se arman en una pasada, no
-- recorriendo la tabla dos veces por persona.
create or replace function public.fn_boletas_sin_llenar(p_dni text, p_token uuid, p_fecha date default null::date, p_area text default null::text)
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '30s' set jit to 'off'
as $function$
declare v_areas text[]; v_dnis text[]; v_f date; v json;
begin
  v_areas := _boletas_areas(p_dni, p_token, p_area);
  v_f := least(coalesce(p_fecha, _hoy()), _hoy());

  select array_agg(x.dni) into v_dnis from operarios x
   where x.estado = 'ACTIVO' and x.cargo in ('OPERARIO','ESTAJERO') and x.area_actual = any(v_areas);

  with t as materialized (
    select * from _boleta_estados(coalesce(v_dnis, '{}'), v_f - 20, v_f)
  ),
  lab as materialized (
    select f.fecha from (select distinct t.fecha from t) f where _laborable(f.fecha)
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
  u11 as (
    select y.dni, y.fecha, y.estado,
           row_number() over (partition by y.dni order by y.fecha desc) rk
      from t y join lab on lab.fecha = y.fecha
     where y.dni in (select dni from dia where estado = 'PENDIENTE')
  ),
  u11j as (
    select dni,
           json_agg(json_build_object('f', to_char(fecha,'YYYY-MM-DD'), 'e', estado) order by fecha) dias,
           count(*) filter (where estado = 'PENDIENTE') pend11
      from u11 where rk <= 11 group by dni
  ),
  pend as (
    select d.*,
      (select max(r.fecha) from reclamos r where r.dni = d.dni and r.estado = 'ACTIVO' and r.fecha <= v_f) ultimo,
      u.dias, coalesce(u.pend11, 0) pend11,
      av.avisado_por, av.creado av_creado, ap.nombres_apellidos av_nombre
    from dia d
    left join u11j u on u.dni = d.dni
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
end $function$;

-- ===================== F. Días no laborables =====================
-- Igual que antes, pero reclamos y ocurrencias se buscan por índice solo en los
-- días no laborables (antes recorría todos los reclamos activos: ~225 mil filas).
create or replace function public.fn_dias_no_laborables(p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json language plpgsql stable security definer
 set search_path to 'public' set statement_timeout to '20s'
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
      from reclamos r
     where r.estado = 'ACTIVO' and r.fecha = any(array(select f from dias)) group by 1,2,3
  ), tkp as (
    select fecha, dni, sum(m) m, sum(n) n, (array_agg(area order by m desc))[1] area from tk group by 1,2
  ), jo as (
    select oc.fecha, oc.dni, sum(oc.minutos) m, max(oc.area) area
      from ocurrencias oc
     where oc.tipo = 'HORA_EXTRA' and oc.detalle like 'JORNADA %'
       and oc.fecha = any(array(select f from dias)) group by 1,2
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

-- ===================== G. Editar bases sin reescribir lo que no cambió =====================
-- Antes borraba y volvía a insertar todos los tickets de la OF en cada edición
-- (8 mil filas en una OF grande): eso infla la tabla. Ahora solo borra los que
-- ya no van, inserta los nuevos y actualiza los que cambiaron.
-- `actualizado` queda con la fecha en que se generó el ticket, salvo que cambie.
create or replace function public.fn_tickets_cache_refrescar(p_area text, p_of text default null::text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  with n as materialized (
    select codigo, o_f, articulo, modulo, op, n_op, op_id, std, cant, paq, talla, color, desde, hasta
      from fn_tickets_of_raw(p_area, p_of)
  ), del as (
    delete from tickets_cache t
     where t.area = p_area and (p_of is null or t.o_f = p_of)
       and not exists (select 1 from n where n.codigo = t.codigo)
  )
  insert into tickets_cache as t (area, codigo, o_f, articulo, modulo, op, n_op, op_id,
    std, cant, paq, talla, color, desde, hasta)
  select p_area, codigo, o_f, articulo, modulo, op, n_op, op_id,
    std, cant, paq, talla, color, desde, hasta
  from n
  on conflict (area, codigo) do update set
    o_f = excluded.o_f, articulo = excluded.articulo, modulo = excluded.modulo, op = excluded.op,
    n_op = excluded.n_op, op_id = excluded.op_id, std = excluded.std, cant = excluded.cant,
    paq = excluded.paq, talla = excluded.talla, color = excluded.color,
    desde = excluded.desde, hasta = excluded.hasta, actualizado = now()
  where (t.o_f, t.articulo, t.modulo, t.op, t.n_op, t.op_id, t.std, t.cant, t.paq, t.talla, t.color, t.desde, t.hasta)
        is distinct from
        (excluded.o_f, excluded.articulo, excluded.modulo, excluded.op, excluded.n_op, excluded.op_id, excluded.std,
         excluded.cant, excluded.paq, excluded.talla, excluded.color, excluded.desde, excluded.hasta);
end $function$;

-- Igual, pero solo escribe los reclamos cuya ruta cambió (antes reescribía todos
-- los del artículo en cada edición). El conteo devuelto es lo que de verdad cambió.
create or replace function public._sync_reclamos_articulo(p_area text, p_articulo text)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v int; w int;
begin
  -- 1) Por identidad: sobrevive a renombres y reordenamientos.
  update reclamos r
     set nop = x.n_op, modulo = x.modulo, op = x.operacion, std_base = x.std_base, std = x.std
    from (select r2.id, b.n_op, b.modulo, b.operacion,
                 case when r2.causa is null then null else b.std end std_base,
                 case when r2.causa is null then b.std
                      else b.std + coalesce((select c.delta from causas_std c where c.texto = r2.causa), 0) end std
            from reclamos r2 join bases b on b.op_id = r2.op_id
           where b.area = p_area and upper(trim(b.articulo)) = upper(trim(p_articulo))
             and r2.area = p_area) x
   where r.id = x.id
     and (r.nop, r.modulo, r.op, r.std_base, r.std) is distinct from (x.n_op, x.modulo, x.operacion, x.std_base, x.std);
  get diagnostics v = row_count;

  -- 2) Respaldo por nombre para lo que aún no tiene op_id (histórico).
  --    Las adicionales por OF (parche 91) no son de la BASE: nunca se enlazan.
  update reclamos r
     set nop = b.n_op, modulo = b.modulo, op_id = b.op_id,
         std_base = case when r.causa is null then null else b.std end,
         std = case when r.causa is null then b.std
                    else b.std + coalesce((select c.delta from causas_std c
                                            where c.texto = r.causa), 0) end
    from bases b
   where r.op_id is null and r.op_adicional_id is null
     and b.area = p_area and upper(trim(b.articulo)) = upper(trim(p_articulo))
     and r.area = p_area and upper(trim(r.articulo)) = upper(trim(p_articulo))
     and upper(trim(r.op)) = upper(trim(b.operacion));
  get diagnostics w = row_count;

  return v + w;
end $function$;

-- Índice chico (~280 filas) para el paso 2: antes recorría todos los reclamos del área.
create index if not exists reclamos_sin_opid_art_idx on reclamos (area, upper(trim(articulo)))
  where op_id is null and op_adicional_id is null;

commit;

-- DESPUÉS del commit, en una consulta aparte (VACUUM no corre dentro de begin/commit):
-- vacuum (analyze) reclamos;
-- vacuum (analyze) tickets_cache;
