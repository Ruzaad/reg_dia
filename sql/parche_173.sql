-- PARCHE 173 — PCP: calendario por área (Planta, Camisa, Pantalón, Saco, Corte, Acabado, Reproceso).
-- fn_pcp_calendario_areas (lectura): por área y día: hábil, disponible (MOD de la estructura − vacaciones, licencias y DM del día) × jornada,
-- programado (costura: programa de PCP por área; corte: cronograma de corte), real (penúltima operación) y metas.
-- Meta de prendas: costura = suma de CANT PROG del mes (columnas MES/AÑO del programa); corte = cantidad de las OF del cronograma que terminan de cortar en el mes.
-- Meta de minutos: metas_mes (AREA; Planta = corporación); si un área no tiene meta propia se reparte la de la corporación según su disponible del mes (meta_min_derivada). Planta en prendas = Camisa + Pantalón + Saco.
-- No toca fn_pcp_calendario (parche 172). Rollback: parche_173_rollback.sql
begin;

create or replace function public.fn_pcp_calendario_areas(p_dni text, p_token uuid, p_mes date default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare
  o operarios; v_hoy date := _hoy(); v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_fin date;
  v_jor numeric; v_res json; v_ar text[] := array['CAMISA COSTURA','PANTALON COSTURA','SACO COSTURA','CORTE','ACABADO','REPROCESO'];
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  v_fin := (v_mes + interval '1 month - 1 day')::date;
  v_jor := coalesce((select _jornada(d::date) from generate_series(v_mes, v_fin, '1 day') d where _laborable(d::date) limit 1), 575);

  with hd as materialized (
    select g::date d from generate_series(v_mes - 10, v_fin + 130, '1 day') g
     where (extract(isodow from g) < 6 and not exists (select 1 from feriados f where f.fecha = g::date))
        or exists (select 1 from dias_habilitados h where h.fecha = g::date)),
  dm as (select g::date f from generate_series(v_mes, v_fin, '1 day') g),
  ar as (select a from unnest(v_ar) a),
  -- programa de costura (una fila por área) y cronograma de corte, repartidos en los días hábiles de su rango
  pg as materialized (
    select area, ini, fin, cant_prog * std mi, cant_prog un from (
      select area, ini_costura ini, case when fin_costura is null or fin_costura < ini_costura then ini_costura else least(fin_costura, ini_costura + 120) end fin, cant_prog, std
        from pcp_programa where ini_costura is not null and cant_prog > 0) q
     where ini <= v_fin and fin >= v_mes),
  cr as materialized (
    select 'CORTE'::text area, ini, fin, 0::numeric mi, cantidad un from (
      select ini_corte ini, case when fin_corte is null or fin_corte < ini_corte then ini_corte else least(fin_corte, ini_corte + 120) end fin, cantidad
        from pcp_cronograma where ini_corte is not null and cantidad > 0) q
     where ini <= v_fin and fin >= v_mes),
  pn as materialized (
    select u.*, (select count(*) from hd where hd.d between u.ini and u.fin) n from (select * from pg union all select * from cr) u),
  pd as (
    select pn.area, hd.d f, sum(mi / n) mi, sum(un / n) un
      from pn join hd on hd.d between pn.ini and pn.fin and hd.d between v_mes and v_fin where pn.n > 0 group by 1, 2),
  -- real
  pr as (
    select area, fecha f, sum(prendas) un, sum(minutos) mi from (
      select x.area, x.fecha, x.prendas, x.minutos from _pcp_prod(v_mes, v_fin) x
       where x.area <> 'UDP' and not (x.area = 'CORTE' and exists (select 1 from corte_manual c where c.fecha = x.fecha and c.area = 'CORTE'))
      union all
      select area, fecha, prendas, minutos from corte_manual where fecha between v_mes and v_fin and area in ('CORTE', 'REPROCESO')) z group by 1, 2),
  -- disponible: MOD de la estructura del mes menos vacaciones, licencias y DM de ese día
  md as (select dni, area, desde, hasta from estructura_mes where mes = v_mes and tipo = 'MOD' and area = any (v_ar)),
  au as (
    select distinct on (dni, fecha) dni, fecha, estado from asistencia where fecha between v_mes and v_fin order by dni, fecha, creado desc),
  ad as (
    select m.area, a.fecha f, count(*) n from au a join md m on m.dni = a.dni and (m.desde is null or m.desde <= a.fecha) and (m.hasta is null or m.hasta >= a.fecha)
     where a.estado in ('VACACIONES', 'LICENCIA', 'DM') group by 1, 2),
  di as (
    select ar.a area, dm.f,
      case when dm.f in (select d from hd) then
        greatest(0, (select count(*) from md where md.area = ar.a and (md.desde is null or md.desde <= dm.f) and (md.hasta is null or md.hasta >= dm.f)) - coalesce(ad.n, 0)) * v_jor
        else 0 end disp
      from ar cross join dm left join ad on ad.area = ar.a and ad.f = dm.f),
  x as (
    select di.area, di.f, di.disp, coalesce(pd.mi, 0) pmi, coalesce(pd.un, 0) pun, coalesce(pr.mi, 0) rmi, coalesce(pr.un, 0) run
      from di left join pd on pd.area = di.area and pd.f = di.f left join pr on pr.area = di.area and pr.f = di.f),
  xp as (
    select 'PLANTA' area, f, sum(disp) disp, sum(pmi) filter (where area like '%COSTURA') pmi, sum(pun) filter (where area like '%COSTURA') pun,
           sum(rmi) rmi, sum(run) filter (where area like '%COSTURA') run from x group by f),
  t as (select * from x union all select * from xp),
  mm as (
    select area, meta_minutos from metas_mes where mes = v_mes and alcance = 'AREA' and dni is null
    union all select 'PLANTA', coalesce((select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION' and dni is null),
                                         (select sum(meta_minutos) from metas_mes where mes = v_mes and alcance = 'AREA' and dni is null))),
  mu as (
    select area, sum(cant_prog) un from pcp_programa where mes = extract(month from v_mes) and anio = extract(year from v_mes) group by area
    union all select 'CORTE', sum(cantidad) from pcp_cronograma where fin_corte between v_mes and v_fin
    union all select 'PLANTA', sum(cant_prog) from pcp_programa where mes = extract(month from v_mes) and anio = extract(year from v_mes)),
  ka as (select a area from ar union all select 'PLANTA')
  select json_object_agg(ka.area, json_build_object(
      'meta_min', coalesce((select meta_minutos from mm where mm.area = ka.area),
                           round((select meta_minutos from mm where mm.area = 'PLANTA') * (select sum(disp) from t t2 where t2.area = ka.area)
                                 / nullif((select sum(disp) from t t3 where t3.area = 'PLANTA'), 0)), 0),
      'meta_min_derivada', not exists (select 1 from mm where mm.area = ka.area),
      'sam', coalesce((select round(sum(cant_prog * std) / nullif(sum(cant_prog), 0), 2) from pcp_programa g
                        where g.mes = extract(month from v_mes) and g.anio = extract(year from v_mes) and g.cant_prog > 0 and (ka.area = 'PLANTA' or g.area = ka.area)), 0),
      'meta_un', coalesce((select un from mu where mu.area = ka.area), 0),
      'dias', (select json_agg(json_build_object('f', t.f, 'habil', t.f in (select d from hd),
           'tipo', case when exists (select 1 from feriados fe where fe.fecha = t.f) then 'feriado'
                        when extract(isodow from t.f) = 6 then 'sabado' when extract(isodow from t.f) = 7 then 'domingo' else 'normal' end,
           'motivo', coalesce((select fe.motivo from feriados fe where fe.fecha = t.f), (select h.motivo from dias_habilitados h where h.fecha = t.f)),
           'hab_extra', exists (select 1 from dias_habilitados h where h.fecha = t.f),
           'disp_min', round(t.disp), 'prog_min', round(t.pmi), 'prog_un', round(t.pun), 'real_min', round(t.rmi), 'real_un', round(t.run)) order by t.f)
         from t where t.area = ka.area)))
    into v_res from ka;

  return json_build_object('ok', true, 'mes', v_mes, 'hoy', v_hoy, 'jornada', v_jor,
    'puede_editar', coalesce(o.es_admin, false) or exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR'),
    'areas', coalesce(v_res, '{}'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_pcp_calendario_areas(text, uuid, date) from public;
grant execute on function public.fn_pcp_calendario_areas(text, uuid, date) to anon, authenticated;
commit;
