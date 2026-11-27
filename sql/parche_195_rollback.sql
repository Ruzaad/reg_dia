-- Deshace el parche 195: vuelve a crear lo retirado (Paquetes sueltos, Carga vs capacidad,
-- completar OF por lote) y quita las funciones nuevas. No toca datos.
begin;

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

create or replace function public._sueltos_areas(p_dni text, p_token uuid, p_area text)
 returns text[] language plpgsql stable security definer set search_path to 'public' as $$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  if o.cargo = 'SUPERVISORA' then return array[o.area_actual]; end if;
  perform _vista(p_dni, p_token, array['pasoSueltos','pasoAudit'], nullif(p_area,''));
  if coalesce(o.es_admin,false) or exists (select 1 from permisos_area where dni = o.dni and area = '*') then
    return case when nullif(p_area,'') is null then null else array[p_area] end;
  end if;
  return coalesce((select array_agg(area) from permisos_area where dni = o.dni
                    and (nullif(p_area,'') is null or area = p_area)), '{}');
end $$;

create or replace function public.fn_paquetes_sueltos(p_dni text, p_token uuid, p_area text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set work_mem to '32MB'          -- ordena ~160 mil paquetes en memoria (2.5 s con todas las áreas)
as $function$
declare v_areas text[];
begin
  v_areas := _sueltos_areas(p_dni, p_token, p_area);
  return json_build_object('ok', true, 'hoy', _hoy(), 'items', coalesce((
    select json_agg(x order by x.min desc) from (
      select s.area, s.o_f, max(s.articulo) articulo, bool_or(s.parada) parada, max(s.ult) ult, min(s.salto) hueco,
             _dias_hab(case when bool_or(s.parada) then max(s.ult) else min(s.salto) end, _hoy()) dias,
             count(*) paq, round(sum(s.minutos)) min, count(distinct s.n_op) ops,
             count(*) filter (where s.motivo = 'SALTADO') saltados,
             count(*) filter (where s.motivo = 'SIN_REGISTRAR') sin_registrar,
             count(*) filter (where s.motivo = 'NADIE') nadie,
             count(*) filter (where s.liberado) liberados,
             (select max(r.fecha) from reclamos r where r.area = 'ACABADO' and r.o_f = s.o_f and r.estado = 'ACTIVO') acabado
        from _sueltos(v_areas, null) s
       group by s.area, s.o_f) x), '[]'::json),
    'sin_generar', (select count(*) from ofs f where f.fecha_carga < now() - interval '14 days'
                      and not exists (select 1 from tickets_cache t where t.o_f = f.o_f)));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_paquetes_sueltos_of(p_dni text, p_token uuid, p_area text, p_of text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_areas text[];
begin
  v_areas := _sueltos_areas(p_dni, p_token, p_area);
  if v_areas is not null and not (p_area = any(v_areas)) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a %', p_area; end if;
  return json_build_object('ok', true, 'ops', coalesce((
    select json_agg(x order by x.min desc) from (
      select g.*, q.nombre, q.n, q.tot from (
        select s.modulo, s.op, s.n_op, array_agg(s.paq order by s.paq) paqs, round(sum(s.minutos)) min,
               min(s.motivo) motivo, min(s.salto) desde, count(*) filter (where s.liberado) liberados
          from _sueltos(array[p_area], p_of) s
         group by s.modulo, s.op, s.n_op) g
      left join lateral (
        select o.nombres_apellidos nombre, count(*) n, sum(count(*)) over () tot
          from reclamos r join operarios o on o.dni = r.dni
         where r.area = p_area and r.o_f = p_of and r.nop = g.n_op and r.estado = 'ACTIVO'
         group by o.nombres_apellidos order by 2 desc limit 1) q on true) x), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_carga_capacidad(p_dni text, p_token uuid, p_area text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set work_mem to '32MB'
 set statement_timeout to '20s'
 set jit to off
as $function$
declare o operarios; v_areas text[]; v_hoy date := _hoy(); v_hab date[]; v_q date; v_vieja date := _hoy() - 21;
        v_desde date := _hoy() - 120; v_dias date[]; v_out json;
begin
  o := _vista(p_dni, p_token, array['pasoCarga'], nullif(p_area,''));
  if coalesce(o.es_admin,false) or exists (select 1 from permisos_area where dni = o.dni and area = '*') then v_areas := null;
  else select array_agg(area) into v_areas from permisos_area where dni = o.dni; end if;
  if nullif(p_area,'') is not null then v_areas := array[p_area]; end if;

  -- Últimos 10 días hábiles antes de hoy, el corte de "en curso" (7 hábiles) y los próximos 10.
  select array_agg(d order by d desc) into v_hab from (
    select d::date d from generate_series(v_hoy - 30, v_hoy - 1, interval '1 day') d
     where extract(isodow from d) < 6 order by d desc limit 10) z;
  v_q := v_hab[7];
  select array_agg(d order by d) into v_dias from (
    select d::date d from generate_series(v_hoy, v_hoy + 20, interval '1 day') d
     where extract(isodow from d) < 6 order by d limit 10) z;

  with
  costura as (select unnest(array['CAMISA COSTURA','PANTALON COSTURA','SACO COSTURA']) area),
  -- Minutos reclamados por día y área en los 10 días hábiles.
  dia as materialized (
    select r.area, r.fecha, sum(r.minutos) m from reclamos r
     where r.estado = 'ACTIVO' and r.fecha = any(v_hab)
       and r.area in ('CAMISA COSTURA','PANTALON COSTURA','SACO COSTURA','ACABADO')
     group by 1, 2),
  med as (select area, percentile_cont(0.5) within group (order by m) md from dia group by 1),
  gente as (
    select r.area, count(distinct r.dni) n from reclamos r
     where r.estado = 'ACTIVO' and r.fecha = any(v_hab)
       and r.area in ('CAMISA COSTURA','PANTALON COSTURA','SACO COSTURA','ACABADO')
     group by 1),
  ritmo as (
    select d.area, round(avg(d.m)) ritmo, count(*) dias, max(g.n) gente
      from dia d join med on med.area = d.area left join gente g on g.area = d.area
     where d.m >= med.md / 2
     group by d.area),
  -- Tickets por OF, módulo y operación: total, lo que nadie reclamó y el último reclamo
  -- (una sola pasada por reclamos).
  tkm as materialized (
    select t.area, t.o_f, t.modulo, t.n_op, upper(trim(max(t.op))) op, max(t.articulo) articulo,
           sum(t.std * t.cant) tot, coalesce(sum(t.std * t.cant) filter (where r.codigo is null), 0) pend,
           min(t.actualizado) gen, max(r.fecha) ult
      from tickets_cache t
      left join reclamos r on r.area = t.area and r.codigo = t.codigo and r.estado = 'ACTIVO'
     where t.area in ('CAMISA COSTURA','PANTALON COSTURA','SACO COSTURA')
     group by 1, 2, 3, 4),
  ult as (select area, o_f, max(ult) ult from tkm group by 1, 2),
  -- Sin módulos cerrados, con el estado de la OF.
  k as materialized (
    select m.area, m.o_f, m.modulo, m.n_op, m.op, m.articulo, m.tot, m.pend, m.gen, u.ult,
           case when u.ult is null then 'POR_EMPEZAR' when u.ult >= v_q then 'EN_CURSO' else 'QUIETA' end estado
      from tkm m join ult u on u.area = m.area and u.o_f = m.o_f
     where not exists (select 1 from modulos_cerrados c where c.area = m.area and c.o_f = m.o_f and c.modulo = m.modulo)),
  -- Qué parte de cada operación se reclama en las OFs ya terminadas (sin movimiento).
  h_op as (
    select area, op, 1 - sum(pend) / nullif(sum(tot), 0) r, count(distinct o_f) n
      from k where estado = 'QUIETA' group by 1, 2),
  h_area as (
    select area, 1 - sum(pend) / nullif(sum(tot), 0) r from k where estado = 'QUIETA' group by 1),
  -- Pendiente real = lo que nadie reclamó, menos lo que esa operación suele dejar sin reclamar.
  tk as materialized (
    select k.area, k.o_f, max(k.articulo) articulo, max(k.ult) ult, max(k.estado) estado,
           sum(k.tot) tot, sum(k.pend) bruto,
           sum(greatest(0, k.pend - (1 - coalesce(case when ho.n >= 3 then ho.r end, ha.r, 1)) * k.tot)) pend,
           min(k.gen)::date gen_tk
      from k left join h_op ho on ho.area = k.area and ho.op = k.op
      left join h_area ha on ha.area = k.area
     group by k.area, k.o_f),
  -- STD de ACABADO ÷ STD de costura, por artículo.
  ratio as materialized (
    select c.area, c.articulo, a.s / nullif(c.s, 0) k
      from (select area, articulo, sum(std) s from bases where area in ('CAMISA COSTURA','PANTALON COSTURA','SACO COSTURA') group by 1, 2) c
      join (select articulo, sum(std) s from bases where area = 'ACABADO' group by 1) a on a.articulo = c.articulo),
  ofx as materialized (
    select tk.*, coalesce(f.fecha_carga::date, tk.gen_tk) gen, f.cant_prog cant, coalesce(f.prenda, '') prenda, rt.k
      from tk
      left join ofs f on f.o_f = tk.o_f
      left join ratio rt on rt.area = tk.area and rt.articulo = tk.articulo
     where tk.bruto > 0
       and (v_areas is null or tk.area = any(v_areas))
       and (tk.ult >= v_desde or (tk.ult is null and coalesce(f.fecha_carga::date, tk.gen_tk) >= v_desde))),
  activos as (select area_actual area, count(*) n from operarios where cargo = 'OPERARIO' and estado = 'ACTIVO' group by 1),
  -- Asistencia de ACABADO del último día marcado.
  asis_f as (select max(a.fecha) f from asistencia a join operarios op on op.dni = a.dni
              where op.area_actual = 'ACABADO' and a.fecha <= v_hoy),
  asis as (
    select z.estado, count(*) n from (
      select distinct on (a.dni) a.dni, a.estado from asistencia a join operarios op on op.dni = a.dni, asis_f
       where op.area_actual = 'ACABADO' and op.cargo = 'OPERARIO' and op.estado = 'ACTIVO' and a.fecha = asis_f.f
       order by a.dni, a.creado desc) z group by 1)
  select json_build_object('ok', true, 'version', 118,
    'corte', to_char(now() at time zone 'America/Lima', 'DD-MM-YYYY HH24:MI'),
    'dias', v_dias,
    'areas', (
      select json_agg(x) from (
        select json_build_object('area', c.area, 'tipo', 'BASE',
          'ritmo', coalesce(rt.ritmo, 0), 'dias_ritmo', coalesce(rt.dias, 0), 'registran', coalesce(rt.gente, 0),
          'activos', coalesce((select n from activos where area = c.area), 0),
          'tasa', (select round(r * 100, 1) from h_area where area = c.area),
          'curso', coalesce((select round(sum(pend)) from ofx where area = c.area and estado = 'EN_CURSO'), 0),
          'empezar', coalesce((select round(sum(pend)) from ofx where area = c.area and estado = 'POR_EMPEZAR'), 0),
          'curso_bruto', coalesce((select round(sum(bruto)) from ofx where area = c.area and estado = 'EN_CURSO'), 0),
          'empezar_bruto', coalesce((select round(sum(bruto)) from ofx where area = c.area and estado = 'POR_EMPEZAR'), 0),
          'acab_curso', coalesce((select sum(pend * coalesce(k, 0)) from ofx where area = c.area and estado = 'EN_CURSO'), 0),
          'acab_empezar', coalesce((select sum(pend * coalesce(k, 0)) from ofx where area = c.area and estado = 'POR_EMPEZAR'), 0),
          'quietas', json_build_object('n', (select count(*) from ofx where area = c.area and estado = 'QUIETA'),
                                       'min', coalesce((select round(sum(bruto)) from ofx where area = c.area and estado = 'QUIETA'), 0)),
          'viejas', json_build_object('n', (select count(*) from ofx where area = c.area and estado = 'POR_EMPEZAR' and gen < v_vieja),
                                      'min', coalesce((select round(sum(pend)) from ofx where area = c.area and estado = 'POR_EMPEZAR' and gen < v_vieja), 0),
                                      'gen', (select min(gen) from ofx where area = c.area and estado = 'POR_EMPEZAR' and gen < v_vieja)),
          'ofs', coalesce((select json_agg(json_build_object('of', o_f, 'articulo', articulo, 'prenda', prenda, 'cant', cant,
                    'tot', round(tot), 'pend', round(pend), 'bruto', round(bruto), 'ult', ult, 'gen', gen, 'estado', estado,
                    'vieja', estado = 'POR_EMPEZAR' and gen < v_vieja) order by pend desc, bruto desc)
                   from ofx where area = c.area), '[]'::json)) x
          from costura c left join ritmo rt on rt.area = c.area
         where v_areas is null or c.area = any(v_areas)
        union all
        select json_build_object('area', 'ACABADO', 'tipo', 'ACABADO',
          'ritmo', coalesce((select ritmo from ritmo where area = 'ACABADO'), 0),
          'dias_ritmo', coalesce((select dias from ritmo where area = 'ACABADO'), 0),
          'presentes', coalesce((select n from asis where estado = 'ACTIVO'), 0),
          'activos', coalesce((select n from activos where area = 'ACABADO'), 0),
          'prestados', coalesce((select json_object_agg(estado, n) from asis where estado like 'EN %'), '{}'::json),
          'sin_base_acab', coalesce((select json_agg(json_build_object('of', o_f, 'articulo', articulo, 'pend', round(pend)))
                                      from ofx where k is null and estado <> 'QUIETA' and pend > 0), '[]'::json))
         where v_areas is null or 'ACABADO' = any(v_areas)
        union all
        select json_build_object('area', s.area, 'tipo', 'SIN_BASE',
          'activos', coalesce((select n from activos where area = s.area), 0),
          'prestados_aqui', coalesce((select n from asis where estado = s.estado), 0))
          from (values ('CORTE', 'EN CORTE'), ('REPROCESO', 'EN REPROCESO'), ('UDP', 'EN SASTRERIA (UDP)')) s(area, estado)
         where v_areas is null or s.area = any(v_areas)
      ) q),
    'sin_generar', (select json_build_object('n', count(*), 'desde', min(f.fecha_carga)::date, 'hasta', max(f.fecha_carga)::date,
                      'und', coalesce(round(sum(f.cant_prog)), 0))
                      from ofs f where f.fecha_carga < now() - interval '14 days'
                       and not exists (select 1 from tickets_cache t where t.o_f = f.o_f))
  ) into v_out;
  return v_out;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_ofs_completadas(p_dni text, p_token uuid, p_area text default '')
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare s operarios; v_j json;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  select json_agg(x order by x.creado desc) into v_j from (
    select c.area, c.o_f as of, f.articulo, f.prenda, round(f.cant_prog,0) cant,
           count(*) modulos, p.nombres_apellidos as por,
           to_char(max(c.creado) at time zone 'America/Lima','YYYY-MM-DD HH24:MI') as cuando,
           max(c.creado) as creado
      from modulos_cerrados c
      left join ofs f on f.o_f = c.o_f
      left join operarios p on p.dni = c.cerrado_por
     where coalesce(p_area,'') = '' or c.area = p_area
     group by c.area, c.o_f, f.articulo, f.prenda, f.cant_prog, p.nombres_apellidos) x;
  return json_build_object('ok', true, 'ofs', coalesce(v_j, '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_ofs_completar_varias(p_dni text, p_token uuid, p_items jsonb, p_completar boolean)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s operarios; it jsonb; v_n int; v_mod int := 0; v_of int := 0;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(trim(it->>'area'),'') = '' or coalesce(trim(it->>'of'),'') = '' then continue; end if;
    if p_completar then
      insert into modulos_cerrados(area, o_f, modulo, cerrado_por)
      select distinct t.area, t.o_f, upper(trim(t.modulo)), s.dni
        from tickets_cache t
       where t.area = it->>'area' and t.o_f = upper(trim(it->>'of')) and coalesce(trim(t.modulo),'') <> ''
      on conflict (area, o_f, modulo) do nothing;
    else
      delete from modulos_cerrados where area = it->>'area' and upper(trim(o_f)) = upper(trim(it->>'of'));
    end if;
    get diagnostics v_n = row_count;
    v_mod := v_mod + v_n; v_of := v_of + 1;
  end loop;
  return json_build_object('ok', true, 'completada', p_completar, 'ofs', v_of, 'modulos', v_mod);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public._sueltos(text[], text) from public, anon, authenticated;
revoke all on function public._sueltos_areas(text, uuid, text) from public, anon, authenticated;

drop function if exists public.fn_of_editar(text, uuid, text, text, text, text);
drop function if exists public.fn_of_eliminar(text, uuid, text);
drop function if exists public._of_uso(text);
drop function if exists public.fn_admin_asignar(text, uuid, text, boolean);
drop function if exists public.fn_incentivos_tabla_guardar(text, uuid, jsonb);
drop function if exists public.fn_bono_modular_tabla_guardar(text, uuid, jsonb);
drop function if exists public.fn_bases_agregar_varios(text, uuid, text, jsonb);
-- Los límites de % de las tablas de incentivo se dejan abiertos (no pierde datos)

-- Corte sin TALLER (la columna pcp_corte.taller se deja: no pierde datos)
create or replace function public.fn_pcp_corte_cargar(p_dni text, p_token uuid, p_origen text, p_filas jsonb)
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '20s' as $$
declare o operarios; v_n int; v_d date; v_h date;
begin
  o := _pcp_editor(p_dni, p_token);
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'No hay filas de corte con fecha y cantidad');
  end if;
  if jsonb_array_length(p_filas) > 20000 then
    return json_build_object('ok', false, 'error', 'Máximo 20000 filas por carga: elige un rango de fechas más corto');
  end if;
  select min((x->>'fecha')::date), max((x->>'fecha')::date) into v_d, v_h from jsonb_array_elements(p_filas) x;
  delete from pcp_corte where fecha between v_d and v_h;
  insert into pcp_corte (fecha, o_f, articulo, color, cliente, cantidad, corte_real)
  select (x->>'fecha')::date, nullif(trim(x->>'of'), ''), upper(trim(x->>'articulo')), nullif(trim(x->>'color'), ''),
         nullif(trim(x->>'cliente'), ''), (x->>'cantidad')::numeric, nullif(x->>'corte_real', '')::numeric
    from jsonb_array_elements(p_filas) x
   where nullif(x->>'fecha', '') is not null and coalesce(nullif(x->>'cantidad', '')::numeric, 0) <> 0;
  get diagnostics v_n = row_count;
  insert into pcp_cargas (tipo, archivo, filas, desde, hasta, cargado_por, cargado_en)
  values ('CORTE', left(p_origen, 300), v_n, v_d, v_h, o.dni, now())
  on conflict (tipo) do update set archivo = excluded.archivo, filas = excluded.filas, desde = excluded.desde,
    hasta = excluded.hasta, cargado_por = excluded.cargado_por, cargado_en = excluded.cargado_en;
  return json_build_object('ok', true, 'filas', v_n, 'desde', v_d, 'hasta', v_h);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

commit;
