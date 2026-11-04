-- PARCHE 165 — Cronogramas: Acabado por OF en PRENDAS (acumulado), separando saco y pantalón
-- fn_pcp_cronos_prendas: por OF y prenda, lo que costura entregó (penúltima operación) y lo que Acabado terminó
-- (penúltima operación de Acabado de esa prenda), acumulado hasta p_hasta, más la meta de la OF. fn_pcp_cronos no se toca.
-- Rollback: parche_165_rollback.sql
begin;

create or replace function public.fn_pcp_cronos_prendas(p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare v json;
begin
  perform _vista(p_dni, p_token, array['pasoPcp']);
  if p_hasta < p_desde or p_hasta - p_desde > 120 then return json_build_object('ok', false, 'error', 'Rango inválido (máximo 4 meses)'); end if;

  with inr as materialized (
    select r.o_f, r.area, upper(trim(r.articulo)) art, r.nop, sum(r.cant) cant
      from reclamos r where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO'
       and (r.area like '%COSTURA' or r.area = 'ACABADO') and r.nop is not null and r.o_f is not null
     group by 1, 2, 3, 4),
  ia as materialized (select distinct art, _nk(art) k from inr),
  u as materialized (select distinct on (area, k) area, k, n2 from _ultimas(null)),
  ab as materialized (
    select _nk(articulo) k, _acab_sub(prenda) sub, array_agg(distinct n_op order by n_op desc) arr
      from bases where area = 'ACABADO' and n_op > 0 group by 1, 2),
  abp as materialized (
    select ab.k, ab.sub, case when u.n2 = any(ab.arr) then u.n2 else coalesce(ab.arr[2], ab.arr[1]) end pen
      from ab left join u on u.area = 'ACABADO' and u.k = ab.k),
  cand as materialized (
    select i.o_f from inr i join ia using (art) join u on u.area = i.area and u.k = ia.k and u.n2 = i.nop where i.area <> 'ACABADO'
    union
    select o_f from inr where area = 'ACABADO'),
  rr as materialized (
    select r.o_f, r.area, upper(trim(r.articulo)) art, r.nop, r.fecha, sum(r.cant) cant
      from reclamos r join cand c on c.o_f = r.o_f
     where r.fecha <= p_hasta and r.estado = 'ACTIVO' and (r.area like '%COSTURA' or r.area = 'ACABADO') and r.nop is not null
     group by 1, 2, 3, 4, 5),
  ra as materialized (select distinct art, _nk(art) k from rr),
  cos as (
    select rr.o_f, _acab_sub(rr.area) sub, max(rr.art) art,
           sum(rr.cant) filter (where u.n2 = rr.nop) acum,
           min(rr.fecha) filter (where u.n2 = rr.nop and rr.fecha >= p_desde) ini,
           max(rr.fecha) filter (where u.n2 = rr.nop and rr.fecha >= p_desde) fin
      from rr join ra using (art) left join u on u.area = rr.area and u.k = ra.k
     where rr.area <> 'ACABADO' group by 1, 2),
  meta as (
    select o_f, sub, max(c) meta from (
      select rr.o_f, _acab_sub(rr.area) sub, rr.nop, sum(rr.cant) c from rr where rr.area <> 'ACABADO' group by 1, 2, 3) q group by 1, 2),
  aca as (
    select rr.o_f, p.sub, max(rr.art) art, sum(rr.cant) acum,
           min(rr.fecha) filter (where rr.fecha >= p_desde) ini, max(rr.fecha) filter (where rr.fecha >= p_desde) fin
      from rr join ra using (art) join abp p on p.k = ra.k and p.pen = rr.nop
     where rr.area = 'ACABADO' group by 1, 2)
  select coalesce(json_agg(json_build_object('o_f', x.o_f, 'articulo', coalesce(c.art, a.art), 'sub', x.sub,
           'meta', m.meta, 'costura', coalesce(c.acum, 0), 'acabado', coalesce(a.acum, 0),
           'llega_ini', c.ini, 'llega_fin', c.fin, 'acab_ini', a.ini, 'acab_fin', a.fin)
         order by x.o_f, x.sub), '[]'::json)
    into v from (select o_f, sub from cos union select o_f, sub from aca) x
    left join cos c using (o_f, sub) left join aca a using (o_f, sub) left join meta m using (o_f, sub)
   where coalesce(c.ini, a.ini) is not null or coalesce(c.fin, a.fin) is not null;
  return json_build_object('ok', true, 'desde', p_desde, 'hasta', p_hasta, 'ofs', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_pcp_cronos_prendas(text, uuid, date, date) from public;
grant execute on function public.fn_pcp_cronos_prendas(text, uuid, date, date) to anon, authenticated;

commit;
