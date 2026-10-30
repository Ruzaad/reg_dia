-- PARCHE 154 — Inicio: plan del mes por área (disponible, eficiencia meta/óptima/real, proyección) y corte a mano
-- 1) corte_manual: prendas y minutos de CORTE por día, los llena Ingeniería.
-- 2) fn_corte_manual_guardar: guarda (o borra con nulos) el día.
-- 3) fn_inicio_plan: por área, MOD de la estructura del mes × jornada × días laborables, menos los días de
--    VACACIONES y LICENCIA; producido = minutos (penúltima op) hasta el día anterior + corte a mano.
--    UDP se devuelve pero no suma. No se toca ninguna RPC existente.
-- Rollback: parche_154_rollback.sql
begin;

create table if not exists public.corte_manual (
  fecha date primary key,
  prendas numeric not null default 0,
  minutos numeric not null default 0,
  actualizado timestamptz not null default now(),
  actualizado_por text
);
alter table public.corte_manual enable row level security;
revoke all on public.corte_manual from anon, authenticated;

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
  v_fin date; v_h date := coalesce(p_fecha, _hoy()) - 1;
begin
  perform _lector(p_dni, p_token, '');
  v_fin := (v_mes + interval '1 month' - interval '1 day')::date;
  return (with dias as (
      select d::date fecha, _jornada(d::date) j from generate_series(v_mes, v_fin, '1 day') d where _laborable(d::date)),
    est as (
      select dni, area from estructura_mes where mes = v_mes and tipo = 'MOD'),
    aus as (
      select e.area, sum(d.j) filter (where d.fecha < v_f) pas, sum(d.j) tot
      from asistencia a join est e on e.dni = a.dni join dias d on d.fecha = a.fecha
      where a.estado in ('VACACIONES','LICENCIA') group by e.area),
    ar as (
      select e.area, count(*) personas,
        count(*) * (select sum(j) from dias) - coalesce(max(u.tot),0) disp_mes,
        count(*) * coalesce((select sum(j) from dias where fecha < v_f),0) - coalesce(max(u.pas),0) disp_fecha
      from est e left join aus u on u.area = e.area group by e.area),
    pr as (
      select area, sum(minutos) minutos from inicio_mes_cache where mes = v_mes and hasta = v_h and area <> '' group by area
      union all select 'CORTE', sum(minutos) from corte_manual where fecha between v_mes and v_h)
    select json_build_object('ok', true, 'mes', v_mes, 'fecha', v_f,
      'meta', coalesce((select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION'),
                       (select sum(meta_minutos) from metas_mes where mes = v_mes and alcance = 'AREA')),
      'dias', (select count(*) from dias), 'dias_pasados', (select count(*) from dias where fecha < v_f),
      'corte_dia', (select json_build_object('prendas', prendas, 'minutos', minutos) from corte_manual where fecha = v_f),
      'areas', coalesce((select json_agg(json_build_object('area', ar.area, 'personas', ar.personas, 'disp_mes', ar.disp_mes,
          'disp_fecha', ar.disp_fecha, 'minutos', coalesce((select sum(minutos) from pr where pr.area = ar.area),0),
          'cuenta', ar.area <> 'UDP')
        order by array_position(array['CORTE','CAMISA COSTURA','PANTALON COSTURA','SACO COSTURA','ACABADO','REPROCESO','UDP'], ar.area)) from ar), '[]'::json)));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_corte_manual_guardar(text, uuid, date, numeric, numeric) to anon, authenticated;
grant execute on function public.fn_inicio_plan(text, uuid, date) to anon, authenticated;
commit;
