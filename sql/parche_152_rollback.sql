-- Vuelve _pcp_prod a la versión del 147 y quita lo nuevo
begin;
drop function if exists public.fn_pcp_cronos(text, uuid, date, date);
drop function if exists public._acab_sub(text);
create or replace function public._pcp_prod(p_desde date, p_hasta date)
 returns table (fecha date, area text, prendas numeric, minutos numeric)
 language sql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $$
  with g as (
    select r.area, upper(trim(r.articulo)) art, r.nop, r.fecha, sum(r.cant) cant, sum(r.minutos) mins
      from reclamos r where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO' and r.nop is not null
     group by 1, 2, 3, 4),
  u as materialized (select area, k, n2 from _ultimas(null)),
  s as materialized (select area, _nk(articulo) k, sum(std) sam from bases where n_op > 0 group by 1, 2),
  x as (
    select g.fecha, g.area, g.nop, g.cant, g.mins, uu.k, uu.n2, s.sam
      from g left join lateral (select u.k, u.n2 from u where u.area = g.area and u.k = _nk(g.art) limit 1) uu on true
      left join s on s.area = g.area and s.k = uu.k)
  select x.fecha, x.area,
         sum(case when x.k is not null and x.nop = x.n2 then x.cant else 0 end),
         round(sum(case when x.k is null then x.mins when x.nop = x.n2 then x.cant * coalesce(x.sam, 0) else 0 end), 2)
    from x group by x.fecha, x.area
$$;
commit;
