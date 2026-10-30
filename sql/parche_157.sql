-- PARCHE 157 — Inicio: apoyo recibido por área (minutos y personas de otra área que reclamaron tickets ese día)
-- fn_inicio_resumen (misma firma y mismos campos del parche 151): agrega apoyo_min y apoyo_pers por área.
-- Apoyo = personas MOD cuya área de estructura es otra y reclamaron tickets ACTIVOS en esta área ese día.
-- Rollback: parche_157_rollback.sql (vuelve a la definición del parche 151)
begin;

create or replace function public.fn_inicio_resumen(p_dni text, p_token uuid, p_fecha date default null)
 returns json language plpgsql stable security definer set search_path to 'public' set statement_timeout to '20s'
as $function$
declare
  v_f date := coalesce(p_fecha, _hoy()); v_mes date; v_j numeric := _jornada(coalesce(p_fecha, _hoy()));
  v json;
begin
  perform _lector(p_dni, p_token, '');
  v_mes := date_trunc('month', v_f)::date;
  with p as materialized (select * from _pcp_prod(v_f, v_f)),
  tk as (select distinct dni, area from reclamos where fecha = v_f and estado = 'ACTIVO'),
  em as (select dni, area, tipo from estructura_mes where mes = v_mes and (desde is null or desde <= v_f) and (hasta is null or hasta >= v_f)),
  op as (
    select o.dni, coalesce(em.area, o.area_actual) base, coalesce(e.estado, 'ACTIVO') est
      from operarios o
      left join em on em.dni = o.dni
      left join lateral (select a.estado from asistencia a where a.dni = o.dni and a.fecha = v_f order by a.creado desc limit 1) e on true
     where o.cargo = 'OPERARIO'
       and case when exists (select 1 from estructura_mes where mes = v_mes) then em.tipo = 'MOD' else o.estado = 'ACTIVO' end),
  dest as (
    select op.*, case op.est when 'EN ACABADO' then 'ACABADO' when 'EN CAMISAS' then 'CAMISA COSTURA'
             when 'EN SACOS' then 'SACO COSTURA' when 'EN PANTALON' then 'PANTALON COSTURA'
             when 'EN SASTRERIA' then 'UDP' when 'EN REPROCESO' then 'REPROCESO' when 'EN DESPACHO' then 'DESPACHO'
             when 'EN CORTE' then 'CORTE' end d
      from op),
  q as (
    select d.dni,
      case when d.d is not null and (d.d in ('UDP','REPROCESO','DESPACHO','CORTE') or exists (select 1 from tk where tk.dni = d.dni and tk.area = d.d)) then d.d
           else d.base end area,
      not _ausente(d.est) or d.est ~ '^EN ' or exists (select 1 from tk where tk.dni = d.dni) as pres
      from dest d),
  per as (select area, count(*) personal, count(*) filter (where pres) asist from q group by area),
  dia as (select area, sum(prendas) prendas, sum(minutos) minutos from p group by area),
  ap as (
    select r.area, count(distinct r.dni) pers, round(sum(r.minutos)) mins
      from reclamos r join op on op.dni = r.dni
     where r.fecha = v_f and r.estado = 'ACTIVO' and r.area is not null and r.area <> op.base group by r.area),
  mt as (select area, meta_minutos from metas_mes where mes = v_mes and alcance = 'AREA'),
  ar as (select area from per union select area from dia union select area from mt)
  select json_build_object('ok', true, 'fecha', v_f, 'jornada', v_j,
    'meta_mes', coalesce((select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION'), (select sum(meta_minutos) from mt)),
    'areas', coalesce((select json_agg(json_build_object('area', ar.area, 'personal', coalesce(per.personal, 0), 'asistentes', coalesce(per.asist, 0),
        'prendas', round(coalesce(dia.prendas, 0)), 'minutos', round(coalesce(dia.minutos, 0)),
        'tope', coalesce(per.asist, 0) * v_j, 'meta_min', round(coalesce(per.asist, 0) * v_j * 0.8),
        'meta_mes', mt.meta_minutos, 'apoyo_min', coalesce(ap.mins, 0), 'apoyo_pers', coalesce(ap.pers, 0)) order by ar.area)
      from ar left join per using (area) left join dia using (area) left join mt using (area) left join ap using (area)
      where ar.area is not null), '[]'::json)) into v;
  return v;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
