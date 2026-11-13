-- PARCHE 180 — PCP: avance de una OF de Corte a Acabado (panel lateral del cronograma).
-- fn_pcp_of_avance (lectura): corte (cronograma PDF + NOTI_CORTE), cada área de costura (penúltima operación) y Acabado, todo por prendas.
-- No toca tablas ni funciones existentes. Rollback: parche_180_rollback.sql
begin;

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
  cs as (select pr.*,
           (select sum(r.cant) from reclamos r, u where u.area = pr.area and u.k = pr.k and r.o_f = v and r.area = pr.area
               and r.estado = 'ACTIVO' and r.nop = u.n2) hecho,
           (select min(r.fecha) from reclamos r where r.o_f = v and r.area = pr.area and r.estado = 'ACTIVO') desde,
           (select max(r.fecha) from reclamos r where r.o_f = v and r.area = pr.area and r.estado = 'ACTIVO') ult
         from pr),
  ac as (select (select sum(r.cant) from reclamos r, u where u.area = 'ACABADO' and u.k in (select k from pr) and r.o_f = v
                   and r.area = 'ACABADO' and r.estado = 'ACTIVO' and r.nop = u.n2) hecho,
                (select min(r.fecha) from reclamos r where r.o_f = v and r.area = 'ACABADO' and r.estado = 'ACTIVO') desde,
                (select max(r.fecha) from reclamos r where r.o_f = v and r.area = 'ACABADO' and r.estado = 'ACTIVO') ult)
  select json_build_object('ok', true, 'of', v,
    'articulo', (select max(articulo) from pr), 'cliente', (select max(cliente) from pr), 'modelo', (select max(modelo) from pr), 'color', (select max(color) from pr),
    'corte', (select row_to_json(x) from (select cr.cant meta, co.cant hecho, coalesce(co.ini, cr.ini) ini, coalesce(co.fin, cr.fin) fin from cr, co) x),
    'costura', (select coalesce(json_agg(row_to_json(c) order by c.area), '[]'::json) from cs c),
    'acabado', (select row_to_json(a) from (select (select sum(cant) from pr) meta, ac.hecho, ac.desde, ac.ult from ac) a)) into j;
  return j;
end $function$;
revoke all on function public.fn_pcp_of_avance(text, uuid, text) from public;
grant execute on function public.fn_pcp_of_avance(text, uuid, text) to anon, authenticated;

commit;
