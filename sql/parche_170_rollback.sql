-- Deshacer parche 170: quita lo manual de REPROCESO, vuelve la llave a (fecha) y fn_inicio_plan / fn_corte_manual_guardar a su versión del parche 156 / 154.
begin;
delete from public.corte_manual where area <> 'CORTE';
drop function if exists public.fn_corte_manual_guardar(text, uuid, date, text, numeric, numeric);
alter table public.corte_manual drop constraint if exists corte_manual_pkey;
alter table public.corte_manual drop column if exists area;
alter table public.corte_manual add primary key (fecha);

create or replace function public.fn_corte_manual_guardar(p_dni text, p_token uuid, p_fecha date, p_prendas numeric, p_minutos numeric)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _ing(p_dni, p_token);
  if p_fecha is null or p_fecha > _hoy() then raise exception 'FECHA_INVALIDA'; end if;
  if p_prendas is null and p_minutos is null then
    delete from corte_manual where fecha = p_fecha;
  else
    insert into corte_manual (fecha, prendas, minutos, actualizado_por)
    values (p_fecha, greatest(coalesce(p_prendas,0),0), greatest(coalesce(p_minutos,0),0), p_dni)
    on conflict (fecha) do update set prendas = excluded.prendas, minutos = excluded.minutos,
      actualizado = now(), actualizado_por = excluded.actualizado_por;
  end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_inicio_plan(p_dni text, p_token uuid, p_fecha date default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_f date := coalesce(p_fecha, _hoy()); v_mes date := date_trunc('month', coalesce(p_fecha, _hoy()))::date;
  v_fin date := (date_trunc('month', coalesce(p_fecha, _hoy())) + interval '1 month' - interval '1 day')::date;
  v_h date := coalesce(p_fecha, _hoy()) - 1;
  v_prev date := (date_trunc('month', coalesce(p_fecha, _hoy())) - interval '1 month')::date;
  v_prev_fin date := (date_trunc('month', coalesce(p_fecha, _hoy())) - interval '1 day')::date;
begin
  perform _lector(p_dni, p_token, '');
  if v_h >= v_mes then
    insert into inicio_mes_cerrado (mes, area, minutos, hasta)
      select v_mes, area, round(sum(minutos)), v_h from inicio_mes_cache where mes = v_mes and hasta = v_h and area <> '' group by area
    on conflict (mes, area) do update set minutos = excluded.minutos, hasta = excluded.hasta
      where excluded.hasta >= inicio_mes_cerrado.hasta;
  end if;
  return (with dias as (
      select d::date fecha, _jornada(d::date) j from generate_series(v_mes, v_fin, '1 day') d where _laborable(d::date)),
    dias_p as (
      select d::date fecha, _jornada(d::date) j from generate_series(v_prev, v_prev_fin, '1 day') d where _laborable(d::date)),
    ast as (
      select distinct on (dni, fecha) dni, fecha, estado from asistencia
      where fecha between v_prev and v_fin order by dni, fecha, creado desc),
    est as (
      select e.dni, e.area, e.tipo, e.desde, e.hasta from estructura_mes e join operarios o on o.dni = e.dni
      where e.mes = v_mes and e.area <> 'UDP' and e.tipo = 'MOD' and o.estado = 'ACTIVO'
        and (e.hasta is null or e.hasta >= v_f)),
    mod_ as (select dni, area from est where tipo = 'MOD'),
    modp as (
      select dni, area from est where tipo = 'MOD' and (desde is null or desde < v_mes) and (hasta is null or hasta >= v_prev)),
    aus as (
      select m.area, sum(d.j) filter (where d.fecha < v_f) pas, sum(d.j) tot
      from ast a join mod_ m on m.dni = a.dni join dias d on d.fecha = a.fecha
      where a.estado in ('VACACIONES','LICENCIA') group by m.area),
    ausp as (
      select m.area, sum(d.j) tot
      from ast a join modp m on m.dni = a.dni join dias_p d on d.fecha = a.fecha
      where a.estado in ('VACACIONES','LICENCIA') group by m.area),
    ar as (
      select m.area, count(*) personas,
        count(*) * (select coalesce(sum(j),0) from dias) - coalesce(max(u.tot),0) disp_mes,
        count(*) * coalesce((select sum(j) from dias where fecha < v_f),0) - coalesce(max(u.pas),0) disp_fecha
      from mod_ m left join aus u on u.area = m.area group by m.area),
    arp as (
      select m.area, count(*) * (select coalesce(sum(j),0) from dias_p) - coalesce(max(u.tot),0) disp
      from modp m left join ausp u on u.area = m.area group by m.area),
    prev as (
      select area, minutos from inicio_mes_cerrado where mes = v_prev
      union all select 'CORTE', sum(minutos) from corte_manual where fecha between v_prev and v_prev_fin having sum(minutos) > 0),
    efp as (
      select a.area, p.minutos, a.disp, p.minutos / nullif(a.disp, 0) ef
      from arp a join prev p on p.area = a.area where p.minutos > 0),
    pr as (
      select area, sum(minutos) minutos from inicio_mes_cache where mes = v_mes and hasta = v_h and area <> '' group by area
      union all select 'CORTE', sum(minutos) from corte_manual where fecha between v_mes and v_h),
    he as (
      select area, sum(minutos) m from ocurrencias where tipo = 'HORA_EXTRA' and fecha between v_mes and v_f group by area)
    select json_build_object('ok', true, 'mes', v_mes, 'fecha', v_f,
      'meta', coalesce((select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION'),
                       (select sum(meta_minutos) from metas_mes where mes = v_mes and alcance = 'AREA')),
      'dias', (select count(*) from dias), 'dias_pasados', (select count(*) from dias where fecha < v_f),
      'disp_total', (select count(*) from mod_) * (select coalesce(sum(j),0) from dias)
        - coalesce((select sum(d.j) from ast a join mod_ m on m.dni = a.dni join dias d on d.fecha = a.fecha
                    where a.estado in ('VACACIONES','LICENCIA')), 0),
      'prev_mes', v_prev, 'ef_prev', (select sum(minutos) / nullif(sum(disp), 0) from efp),
      'corte_dia', (select json_build_object('prendas', prendas, 'minutos', minutos) from corte_manual where fecha = v_f),
      'areas', coalesce((select json_agg(json_build_object('area', ar.area, 'estructura', (select count(*) from est x where x.area = ar.area),
          'personas', ar.personas, 'disp_mes', ar.disp_mes, 'disp_fecha', ar.disp_fecha,
          'minutos', coalesce((select sum(minutos) from pr where pr.area = ar.area), 0),
          'he_min', coalesce((select m from he where he.area = ar.area), 0),
          'ef_prev', (select ef from efp where efp.area = ar.area))
        order by array_position(array['CORTE','CAMISA COSTURA','PANTALON COSTURA','SACO COSTURA','ACABADO','REPROCESO'], ar.area)) from ar), '[]'::json)));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
