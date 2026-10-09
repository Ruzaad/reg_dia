-- PARCHE 118 — Carga vs capacidad: más rápida y sin contar colas que nunca se reclaman
-- Reemplaza fn_carga_capacidad del parche 107 (misma firma, mismo permiso, solo lectura).
--   * Velocidad: con el 107 la consulta tardaba de 2 a 4 s y la base le corta a la
--     app a los 3 s (la pantalla daba error). Ahora agrupa por módulo antes de mirar
--     los módulos cerrados, lee reclamos una sola vez y tiene su propio límite de 20 s
--     (como fn_incentivos_quincena). En la base real tarda 1.5 a 2 s.
--   * Colas: en las OFs ya terminadas cada área deja sin reclamar parte de sus
--     minutos (operaciones que nadie marca: CAMISA ~8 %, PANTALON ~6 %, SACO ~26 %).
--     Esos minutos se veían como trabajo pendiente y alargaban los días (sobre todo
--     en SACO). Ahora, por operación, se descuenta lo que esa operación suele quedar
--     sin reclamar en las OFs terminadas del área (si la operación sale en menos de
--     3 OFs terminadas, se usa la tasa del área). El pendiente sin descontar se sigue
--     devolviendo como "bruto".
-- Rollback: parche_118_rollback.sql (vuelve a la versión del 107).
begin;

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

commit;
