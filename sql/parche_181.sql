-- PARCHE 181 — PCP: la cantidad programada se reemplaza por lo cortado real (NOTI_CORTE) y el panel de OF carga rápido.
-- 1) fn_pcp_costura (misma firma): si la OF tiene salida en NOTI_CORTE, Cant prog = lo cortado. NOTI_CORTE no distingue prendas (ternos),
--    así que el mismo total vale para saco y pantalón: se reparte por área entre las filas de esa OF en orden de inicio. Devuelve cant_plan (lo programado) y cortado.
--    Mientras una fila no recibe corte, conserva lo programado.
-- 2) fn_pcp_of_avance (misma firma): una sola pasada por los reclamos de la OF (el min/max por área recorría 259 mil filas; 0,63 s → ~0,15 s),
--    la meta de Corte es lo programado (no la suma de áreas) y la meta de costura es lo cortado.
-- No crea tablas. Rollback: parche_181_rollback.sql
begin;

create or replace function public.fn_pcp_costura(p_dni text, p_token uuid, p_mes date default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare
  o operarios; v_hoy date := _hoy(); v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date;
  v_d date; v_h date; v_filas json; v_metas json;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  v_d := date_trunc('week', v_mes)::date;
  v_h := (date_trunc('week', (v_mes + interval '1 month - 1 day')::date) + interval '6 days')::date;
  with u as materialized (select area, k, n2 from _ultimas('')),
  cc as (select _of_planta(o_f) ofp, sum(cantidad) cort from pcp_corte group by 1),
  pr0 as (
    select p.*, _nk(p.articulo) k, _of_planta(p.o_f) ofp, cc.cort,
           sum(p.cant_prog) over (partition by _of_planta(p.o_f), p.area) tot_of,
           coalesce(sum(p.cant_prog) over (partition by _of_planta(p.o_f), p.area order by p.ini_costura nulls last, p.id
                      rows between unbounded preceding and 1 preceding), 0) previo,
           row_number() over (partition by _of_planta(p.o_f), p.area order by p.ini_costura desc nulls first, p.id desc) ult
      from pcp_programa p left join cc on cc.ofp = _of_planta(p.o_f)
     where p.area like '%COSTURA'),
  pr as (
    select pr0.*,
      coalesce(nullif(case when pr0.cort is null then null
        else least(pr0.cant_prog, greatest(pr0.cort - pr0.previo, 0))
             + case when pr0.ult = 1 then greatest(pr0.cort - pr0.tot_of, 0) else 0 end end, 0), pr0.cant_prog) cant_c
      from pr0
     where pr0.ini_costura between v_d and v_h or (pr0.ini_costura is null and v_mes = date_trunc('month', v_hoy)::date)),
  x as (
    select pr.*,
      bb.n_base, bb.std_base,
      (select count(*) from bases b where b.area <> pr.area and _nk(b.articulo) = pr.k) n_otra,
      (select o2.o_f from ofs o2 where o2.o_f = pr.ofp) of_ok,
      uu.n2,
      (select sum(r.cant) from reclamos r where r.o_f = pr.ofp and r.area = pr.area and r.estado = 'ACTIVO' and r.nop = uu.n2) hecho,
      (select count(*) from reclamos r where r.o_f = pr.ofp and r.area = pr.area and r.estado = 'ACTIVO') n_recl,
      case when nullif(trim(pr.linea), '') is null or trim(pr.linea) = '-' then null
           when not exists (select 1 from operarios s where s.cargo = 'SUPERVISORA' and s.area_actual = pr.area
                              and position(_nk(pr.linea) in _nk(s.nombres_apellidos)) > 0) then null
           else nullif((select count(*) from estructura_mes e
                 where e.tipo = 'MOD' and e.area = pr.area and e.mes = date_trunc('month', coalesce(pr.ini_costura, v_hoy))::date
                   and (e.desde is null or e.desde <= coalesce(pr.ini_costura, v_hoy))
                   and (e.hasta is null or e.hasta >= coalesce(pr.ini_costura, v_hoy))), 0) end est
      from pr
      left join u uu on uu.area = pr.area and uu.k = pr.k
      left join lateral (
        select count(*) n_base, sum(b.std) filter (where q.np <= 1 or _nk(b.prenda) = _nk(pr.prenda)) std_base
          from bases b, lateral (select count(distinct _nk(b2.prenda)) np from bases b2 where b2.area = pr.area and _nk(b2.articulo) = pr.k) q
         where b.area = pr.area and _nk(b.articulo) = pr.k) bb on true),
  y as (
    select x.*, nullif(x.std_base, 0) std_b,
      case when x.est > 0 then x.est * 9.57 * 60 end min_dia,
      case when x.n2 is not null and x.of_ok is not null and x.cant_c > 0 and (coalesce(x.hecho, 0) > 0 or x.ini_costura <= v_hoy)
           then round(least(100, coalesce(x.hecho, 0) / x.cant_c * 100)) end status
      from x)
  select json_agg(json_build_object(
      'id', y.id, 'planta', y.planta, 'linea', y.linea, 'prenda', y.prenda, 'cliente', y.cliente, 'articulo', y.articulo,
      'modelo', y.modelo, 'color', y.color, 'o_f', y.o_f, 'target', y.target, 'cant_prog', y.cant_c, 'cant_plan', y.cant_prog, 'cortado', y.cort,
      'std', y.std_b, 'std_prog', y.std, 'est', y.est, 'min_dia', round(y.min_dia),
      'dias', case when y.std_b is not null and y.min_dia is not null and y.cant_c > 0 then round(y.cant_c * y.std_b / y.min_dia, 1) end,
      'ini', y.ini_costura, 'fin', y.fin_costura, 'area', y.area, 'hecho', y.hecho, 'status', y.status,
      'bloquea', y.n_base = 0,
      'obs', array_remove(array[
        case when y.o_f is null then 'PROGRAMA SIN OF' end,
        case when y.cant_c <= 0 or y.ini_costura is null or y.fin_costura is null then 'DATOS INCOMPLETOS EN EL PROGRAMA' end,
        case when y.n_base = 0 and y.n_otra = 0 then 'ARTÍCULO NO REGISTRADO EN CHRONOS'
             when y.n_base = 0 then 'SIN BASE DE OPERACIONES' end,
        case when y.n_base > 0 and y.std_b is null then 'STD NO ENCONTRADO EN BALANCE DE LÍNEA' end,
        case when y.o_f is not null and y.of_ok is null then 'OF NO CREADA EN CHRONOS' end,
        case when y.n_base > 0 and y.n2 is null then 'NO SE IDENTIFICA LA SECUENCIA DE OPERACIONES' end,
        case when y.est is null and y.linea is not null and trim(y.linea) <> '-' then 'ESTRUCTURA DE LÍNEA NO DISPONIBLE'
             when y.linea is null or trim(y.linea) = '-' then 'LÍNEA NO ASIGNADA EN EL PROGRAMA' end,
        case when y.of_ok is not null and y.n_recl = 0 and y.ini_costura <= v_hoy then 'SIN REGISTROS DE PRODUCCIÓN' end,
        case when y.of_ok is not null and y.n2 is not null and y.status is null and y.n_recl > 0 then 'NO SE PUEDE CALCULAR EL STATUS' end
      ], null)) order by y.ini_costura nulls last, y.planta, y.linea, y.o_f)
    into v_filas from y;
  select coalesce(json_object_agg(case when alcance = 'CORPORACION' then 'PLANTA' else area end, meta_minutos), '{}'::json)
    into v_metas from metas_mes where mes = v_mes;
  return json_build_object('ok', true, 'hoy', v_hoy, 'mes', v_mes, 'desde', v_d, 'hasta', v_h,
    'puede_editar', coalesce(o.es_admin, false) or exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR'),
    'metas', v_metas, 'filas', coalesce(v_filas, '[]'::json),
    'carga', (select json_build_object('archivo', archivo, 'filas', filas, 'cargado_en', cargado_en) from pcp_cargas where tipo = 'PROGRAMA'));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_pcp_costura(text, uuid, date) from public;
grant execute on function public.fn_pcp_costura(text, uuid, date) to anon, authenticated;

create or replace function public.fn_pcp_of_avance(p_dni text, p_token uuid, p_of text)
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
declare o operarios; v text := _of_planta(p_of); j json;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  if v is null then return json_build_object('ok', false, 'error', 'OF sin número'); end if;
  with u as materialized (select area, k, n2 from _ultimas('')),
  pr as (select area, _nk(articulo) k, max(articulo) articulo, max(cliente) cliente, max(modelo) modelo, max(color) color,
                max(linea) linea, sum(cant_prog) cant, min(ini_costura) ini, max(fin_costura) fin
           from pcp_programa where area like '%COSTURA' and _of_planta(o_f) = v group by area, _nk(articulo)),
  cr as (select sum(cantidad) cant, min(ini_corte) ini, max(fin_corte) fin from pcp_cronograma where _of_planta(o_f) = v),
  co as (select sum(cantidad) cant, min(fecha) ini, max(fecha) fin from pcp_corte where _of_planta(o_f) = v),
  rc as (select r.area, r.nop, sum(r.cant) c, min(r.fecha) d, max(r.fecha) f
           from reclamos r where r.o_f = v and r.estado = 'ACTIVO' and (r.area like '%COSTURA' or r.area = 'ACABADO') group by 1, 2),
  ra as (select area, min(d) desde, max(f) ult from rc group by 1),
  cs as (select pr.area, pr.linea, pr.articulo, pr.cliente, pr.modelo, pr.color, pr.cant plan, coalesce(nullif(co.cant, 0), pr.cant) cant,
           (select sum(rc.c) from rc, u where u.area = pr.area and u.k = pr.k and rc.area = pr.area and rc.nop = u.n2) hecho,
           ra.desde, ra.ult, pr.ini, pr.fin
         from pr cross join co left join ra on ra.area = pr.area),
  ac as (select (select sum(rc.c) from rc, u where u.area = 'ACABADO' and u.k in (select k from pr) and rc.area = 'ACABADO' and rc.nop = u.n2) hecho,
                (select desde from ra where area = 'ACABADO') desde, (select ult from ra where area = 'ACABADO') ult)
  select json_build_object('ok', true, 'of', v,
    'articulo', (select max(articulo) from pr), 'cliente', (select max(cliente) from pr), 'modelo', (select max(modelo) from pr), 'color', (select max(color) from pr),
    'corte', (select row_to_json(x) from (select coalesce((select max(cant) from pr), cr.cant) meta, co.cant hecho, coalesce(co.ini, cr.ini) ini, coalesce(co.fin, cr.fin) fin from cr, co) x),
    'costura', (select coalesce(json_agg(row_to_json(c) order by c.area), '[]'::json) from cs c),
    'acabado', (select row_to_json(a) from (select (select sum(cant) from cs) meta, ac.hecho, ac.desde, ac.ult from ac) a)) into j;
  return j;
end $function$;

commit;
