-- Deshacer parche 171: vuelve a la versión del parche 147 (lenta).
/* Núcleo del seguimiento. Sin permisos propios: lo llaman fn_pcp_seguimiento y fn_pcp_api. */
create or replace function public._pcp_seguimiento(p_mes date default null, p_of text default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare
  v_hoy date := _hoy(); v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_fin date;
  v_prod jsonb; v_lab int; v_meta numeric; v_gantt json; v_cump json; v_res json; v_sem json; v_dias json; v_planes json;
begin
  v_fin := (v_mes + interval '1 month - 1 day')::date;
  select count(*) into v_lab from generate_series(v_mes, v_fin, '1 day') d where _laborable(d::date);
  v_meta := coalesce((select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION'),
                     (select sum(meta_minutos) from metas_mes where mes = v_mes and alcance = 'AREA'), 0);

  select coalesce(jsonb_agg(jsonb_build_object('fe', fecha, 'ar', area, 'mi', minutos)), '[]'::jsonb) into v_prod from _pcp_prod(v_mes, v_fin);

  /* Cumplimiento del cronograma: plan de corte y de inicio de costura contra lo real. */
  with cr as (
    select c.*,
           (select coalesce(sum(k.cantidad), 0) from pcp_corte k
             where (c.o_f is not null and k.o_f = _of_planta(c.o_f))
                or (c.o_f is null and k.articulo = c.articulo and k.fecha >= coalesce(c.ini_corte, v_mes) - 5)) cortado,
           (select min(k.fecha) from pcp_corte k
             where (c.o_f is not null and k.o_f = _of_planta(c.o_f))
                or (c.o_f is null and k.articulo = c.articulo and k.fecha >= coalesce(c.ini_corte, v_mes) - 5)) c_ini,
           (select max(k.fecha) from pcp_corte k
             where (c.o_f is not null and k.o_f = _of_planta(c.o_f))
                or (c.o_f is null and k.articulo = c.articulo and k.fecha >= coalesce(c.ini_corte, v_mes) - 5)) c_fin,
           (select min(r.fecha) from reclamos r
             where c.o_f is not null and r.o_f = _of_planta(c.o_f) and r.estado = 'ACTIVO' and r.area like '%COSTURA'
               and r.fecha >= coalesce(c.ini_corte, v_hoy) - 30) s_ini,
           (select sum(r.minutos) from reclamos r
             where c.o_f is not null and r.o_f = _of_planta(c.o_f) and r.estado = 'ACTIVO' and r.area like '%COSTURA'
               and r.fecha >= coalesce(c.ini_corte, v_hoy) - 30) s_min,
           (select sum(p.cant_prog * p.std) from pcp_programa p where c.o_f is not null and _of_planta(p.o_f) = _of_planta(c.o_f)) s_prog
      from pcp_cronograma c
     where p_of is null or _of_planta(c.o_f) = _of_planta(p_of) or c.articulo = upper(p_of)),
  e as (
    select cr.*,
      case when cortado >= cantidad and cantidad > 0 then (case when c_fin <= fin_corte then 'A TIEMPO' else 'TARDE' end)
           when fin_corte < v_hoy then 'ATRASADO'
           when ini_corte <= v_hoy then 'EN CURSO'
           else 'PENDIENTE' end e_corte,
      case when s_ini is not null then (case when s_ini <= ini_costura then 'A TIEMPO' else 'TARDE' end)
           when ini_costura >= v_hoy then 'PENDIENTE'
           when o_f is null then 'SIN OF'
           else 'SIN ARRANCAR' end e_cos
      from cr)
  select
    (select json_agg(json_build_object(
        'o_f', _of_planta(o_f), 'o_f10', o_f, 'pedido', pedido, 'cliente', cliente, 'articulo', articulo, 'material', material, 'cantidad', cantidad,
        'ini_corte', ini_corte, 'fin_corte', fin_corte, 'ini_costura', ini_costura,
        'cortado', cortado, 'corte_ini_real', c_ini, 'corte_fin_real', case when cortado >= cantidad and cantidad > 0 then c_fin end,
        'costura_ini_real', s_ini, 'costura_avance', case when s_prog > 0 then round(least(1, coalesce(s_min, 0) / s_prog) * 100) end,
        'e_corte', e_corte, 'e_costura', e_cos,
        'falta_corte', ini_costura <= v_hoy and cortado < cantidad)
      order by o_f nulls last, articulo) from (select * from e limit 300) e2),
    (select json_build_object(
        'total', count(*),
        'corte_vencidos', count(*) filter (where fin_corte <= v_hoy),
        'corte_a_tiempo', count(*) filter (where fin_corte <= v_hoy and e_corte = 'A TIEMPO'),
        'corte_tarde', count(*) filter (where e_corte = 'TARDE'),
        'corte_atrasado', count(*) filter (where e_corte = 'ATRASADO'),
        'corte_en_curso', count(*) filter (where e_corte = 'EN CURSO'),
        'corte_pendiente', count(*) filter (where e_corte = 'PENDIENTE'),
        'costura_vencidos', count(*) filter (where ini_costura <= v_hoy and o_f is not null),
        'costura_a_tiempo', count(*) filter (where ini_costura <= v_hoy and e_cos = 'A TIEMPO'),
        'costura_tarde', count(*) filter (where e_cos = 'TARDE'),
        'costura_sin_arrancar', count(*) filter (where e_cos = 'SIN ARRANCAR'),
        'costura_sin_of', count(*) filter (where e_cos = 'SIN OF'),
        'costura_pendiente', count(*) filter (where e_cos = 'PENDIENTE'),
        'falta_corte', count(*) filter (where ini_costura <= v_hoy and cortado < cantidad)) from e)
    into v_cump, v_res;

  /* Gantt: OF del programa que arrancan costura (o ya arrancaron) sin corte completo, ordenadas por OF. */
  select json_agg(x order by x.o_f, x.articulo) into v_gantt from (
    select _of_planta(p.o_f) o_f, p.articulo, p.cliente, p.area, p.cant_prog, coalesce(k.cortado, 0) cortado,
           cr.ini_corte, cr.fin_corte, p.ini_costura, p.fin_costura, k.f_ini corte_ini_real, k.f_fin corte_fin_real, s.ini costura_ini_real,
           case when p.cant_prog * p.std > 0 then round(least(1, coalesce(s.mins, 0) / (p.cant_prog * p.std)) * 100) end costura_avance
      from pcp_programa p
      left join lateral (select c.ini_corte, c.fin_corte from pcp_cronograma c
                          where (c.o_f is not null and _of_planta(c.o_f) = _of_planta(p.o_f)) or (c.o_f is null and c.articulo = p.articulo)
                          order by (c.o_f is not null) desc limit 1) cr on true
      left join lateral (select sum(cantidad) cortado, min(fecha) f_ini, max(fecha) f_fin from pcp_corte where o_f = _of_planta(p.o_f)) k on true
      left join lateral (select min(fecha) ini, sum(minutos) mins from reclamos r
                          where r.o_f = _of_planta(p.o_f) and r.estado = 'ACTIVO' and r.area = p.area and r.fecha >= v_hoy - 120) s on true
     where p.o_f is not null and p.ini_costura between v_hoy - 15 and v_hoy + 10
       and coalesce(k.cortado, 0) < p.cant_prog
       and coalesce(upper(p.estatus), '') not like 'FINALIZ%'
       and (p_of is null or _of_planta(p.o_f) = _of_planta(p_of))
     order by _of_planta(p.o_f), p.articulo limit 100) x;

  /* Semanas (lunes a domingo) del mes: compromiso = meta, demanda = programa por fin de costura, real = producido. */
  select json_agg(json_build_object('ini', a, 'fin', b, 'laborables', lab,
      'meta', case when v_lab > 0 then round(v_meta * lab / v_lab) else 0 end,
      'programa', round(coalesce((select sum(cant_prog * std) from pcp_programa where fin_costura between a and b), 0)),
      'real', round(coalesce((select sum(q.mi) from jsonb_to_recordset(v_prod) q(fe date, ar text, mi numeric) where q.fe between a and b), 0)),
      'cerrada', b < v_hoy) order by a)
    into v_sem
    from (select greatest(ws, v_mes) a, least(ws + 6, v_fin) b,
                 (select count(*) from generate_series(greatest(ws, v_mes), least(ws + 6, v_fin), '1 day') d where _laborable(d::date)) lab
            from (select distinct date_trunc('week', d)::date ws from generate_series(v_mes, v_fin, '1 day') d) w) s;

  /* Días del mes: meta, disponible (MOD de la estructura × jornada), producido y personas. */
  select json_agg(json_build_object('f', g.d, 'lab', _laborable(g.d),
      'meta', case when _laborable(g.d) and v_lab > 0 then round(v_meta / v_lab) end,
      'disp', case when _laborable(g.d) then
                (select count(*) from estructura_mes e where e.mes = v_mes and e.tipo = 'MOD'
                    and (e.desde is null or e.desde <= g.d) and (e.hasta is null or e.hasta >= g.d)) * _jornada(g.d) end,
      'real', round(coalesce(p.m, 0)), 'personas', coalesce(w.pers, 0)) order by g.d)
    into v_dias
    from (select d::date d from generate_series(v_mes, v_fin, '1 day') d) g
    left join (select fe, sum(mi) m from jsonb_to_recordset(v_prod) q(fe date, ar text, mi numeric) group by fe) p on p.fe = g.d
    left join (select fecha, count(distinct dni) pers from reclamos
                where fecha between v_mes and v_fin and estado = 'ACTIVO' group by fecha) w on w.fecha = g.d;

  select json_object_agg(tipo, json_build_object('archivo', archivo, 'filas', filas, 'desde', desde, 'hasta', hasta, 'cargado_en', cargado_en))
    into v_planes from pcp_cargas;

  return json_build_object('ok', true, 'mes', v_mes, 'hoy', v_hoy, 'laborables', v_lab, 'meta_mes', v_meta,
    'planes', coalesce(v_planes, '{}'::json), 'resumen', v_res, 'cronograma', coalesce(v_cump, '[]'::json),
    'gantt', coalesce(v_gantt, '[]'::json), 'semanas', coalesce(v_sem, '[]'::json), 'dias', coalesce(v_dias, '[]'::json));
end $function$;
revoke all on function public._pcp_seguimiento(date, text) from public, anon, authenticated;
