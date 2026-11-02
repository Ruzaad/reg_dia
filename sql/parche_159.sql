-- PARCHE 159 — PCP: UDP fuera de la tabla de metas por área
-- fn_pcp_resumen (misma firma y mismos campos): las áreas que devuelve ya no incluyen UDP.
-- UDP sigue mapeada en la estructura y la asistencia, pero no es dato de PCP.
-- Rollback: parche_159_rollback.sql (vuelve a la definición del parche 144 en producción)
begin;

create or replace function public.fn_pcp_resumen(p_dni text, p_token uuid, p_mes date default null::date)
 returns json language plpgsql stable security definer set search_path to 'public' set statement_timeout to '20s'
as $function$
declare
  o operarios; v_hoy date := _hoy(); v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_fin date;
  v_lab int; v_trans int; v_jor numeric; v_puede boolean; v_areas json; v_prog json; v_venc json; v_arr json; v_corte json; v_cargas json;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  v_fin := (v_mes + interval '1 month - 1 day')::date;
  v_puede := coalesce(o.es_admin, false) or exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR');
  select count(*), count(*) filter (where d::date < v_hoy), coalesce(max(_jornada(d::date)), 0) into v_lab, v_trans, v_jor
    from generate_series(v_mes, v_fin, '1 day') d where _laborable(d::date);

  with prod as (
    select q.area, q.fecha, q.minutos mins, coalesce(w.pers, 0) pers
      from _pcp_prod(v_mes, v_fin) q
      left join (select area, fecha, count(distinct dni) pers from reclamos
                  where fecha between v_mes and v_fin and estado = 'ACTIVO' group by area, fecha) w
             on w.area = q.area and w.fecha = q.fecha),
  est as (
    select area, count(*) filter (where tipo = 'MOD' and (hasta is null or hasta >= least(v_hoy, v_fin))) mod
      from estructura_mes where mes = v_mes group by area),
  met as (select area, meta_minutos from metas_mes where mes = v_mes and alcance = 'AREA'),
  ar as (
    select area from est where mod > 0
    union select area from met
    union select area from prod)
  select json_agg(json_build_object(
      'area', ar.area,
      'personas', coalesce(est.mod, 0),
      'disponible_dia', coalesce(est.mod, 0) * v_jor,
      'meta_mes', met.meta_minutos,
      'meta_dia', case when v_lab > 0 then round(met.meta_minutos / v_lab) end,
      'producido', coalesce((select sum(mins) from prod p where p.area = ar.area), 0),
      'producido_hoy', coalesce((select sum(mins) from prod p where p.area = ar.area and p.fecha = v_hoy), 0),
      'dias', (select json_agg(json_build_object('f', p.fecha, 'm', round(p.mins), 'p', p.pers) order by p.fecha)
                 from prod p where p.area = ar.area))
    order by ar.area)
    into v_areas
    from ar left join est using (area) left join met using (area)
   where ar.area <> 'UDP';

  with pr as (
    select area, sum(cant_prog * std) prog,
           sum(cant_prog * std) filter (where fin_costura < v_hoy) debia,
           sum(cant_prog) prendas, count(*) filas
      from pcp_programa
     where anio = extract(year from v_mes) and mes = extract(month from v_mes)
     group by area)
  select json_agg(json_build_object('area', area, 'programa', round(prog), 'debia', round(coalesce(debia, 0)),
                                    'prendas', prendas, 'filas', filas) order by area)
    into v_prog from pr;

  with cor as (select o_f, sum(cantidad) cortado from pcp_corte where o_f is not null group by o_f),
  p as (
    select pp.area, _of_planta(pp.o_f) o_f, pp.articulo, pp.cliente, pp.cant_prog, pp.std, pp.ini_costura, pp.fin_costura, pp.estatus,
           coalesce(c.cortado, 0) cortado
      from pcp_programa pp left join cor c on c.o_f = _of_planta(pp.o_f))
  select
    (select json_agg(x) from (
       select area, o_f, articulo, cliente, round(cant_prog * std) minutos, fin_costura fin, cant_prog, cortado
         from p
        where fin_costura < v_hoy and fin_costura >= v_mes - 60
          and coalesce(upper(estatus), '') not like 'FINALIZ%'
        order by cant_prog * std desc limit 25) x),
    (select json_agg(x) from (
       select area, o_f, articulo, cliente, ini_costura ini, fin_costura fin, cant_prog, cortado
         from p
        where ini_costura between v_hoy - 3 and v_hoy + 10 and o_f is not null and cortado < cant_prog
          and coalesce(upper(estatus), '') not like 'FINALIZ%'
        order by ini_costura, cant_prog - cortado desc limit 30) x)
    into v_venc, v_arr;

  select json_build_object(
      'dias', (select json_agg(json_build_object('f', fecha, 'c', c) order by fecha)
                 from (select fecha, sum(cantidad) c from pcp_corte where fecha between v_mes and v_fin group by fecha) d),
      'total', (select coalesce(sum(cantidad), 0) from pcp_corte where fecha between v_mes and v_fin),
      'ofs', (select json_agg(x) from (
                select o_f, max(articulo) articulo, max(cliente) cliente, sum(cantidad) cantidad, max(fecha) ultima
                  from pcp_corte where fecha between v_mes - 15 and v_fin
                 group by o_f order by max(fecha) desc, sum(cantidad) desc limit 40) x))
    into v_corte;

  select json_object_agg(tipo, json_build_object('archivo', archivo, 'filas', filas, 'desde', desde, 'hasta', hasta,
           'por', (select nombres_apellidos from operarios where dni = c.cargado_por), 'en', cargado_en))
    into v_cargas from pcp_cargas c;

  return json_build_object('ok', true, 'mes', v_mes, 'hoy', v_hoy, 'laborables', v_lab, 'transcurridos', v_trans,
    'hoy_laborable', _laborable(v_hoy) and v_hoy between v_mes and v_fin, 'puede_editar', v_puede,
    'meta_corp', (select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION'),
    'areas', coalesce(v_areas, '[]'::json), 'programa', coalesce(v_prog, '[]'::json),
    'vencidas', coalesce(v_venc, '[]'::json), 'arranque', coalesce(v_arr, '[]'::json),
    'corte', v_corte, 'cargas', coalesce(v_cargas, '{}'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
