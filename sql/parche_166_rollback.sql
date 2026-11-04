-- DESHACER PARCHE 166 — vuelve _boleta_estados y _pcp_prod a la versión que
-- tenían en producción el 4-nov-2026 (escritas aquí, sin tabla de respaldo).

begin;

create or replace function public._boleta_estados(p_dnis text[], p_desde date, p_hasta date)
 returns table(dni text, fecha date, estado text)
 language plpgsql stable security definer
 set search_path to 'public' set jit to 'off'
as $function$
begin
  return query execute $q$
  with o as (
    select x.dni, x.area_actual, x.area_origen from operarios x where x.dni = any($1)
  ),
  ini as (
    select z.dni, min(z.f) f from (
      select o.dni, (select r.fecha from reclamos r
                      where r.dni = o.dni and r.fecha >= $2 - 90 order by r.fecha limit 1) f from o
      union all select c.dni, min(c.fecha) from ocurrencias c where c.dni = any($1) group by c.dni
      union all select a.dni, min(a.fecha) from asistencia a where a.dni = any($1) group by a.dni
    ) z group by z.dni
  ),
  rec as (
    select r.dni, r.fecha from reclamos r
    where r.estado = 'ACTIVO' and r.fecha between $2 and $3 and r.dni = any($1)
    group by r.dni, r.fecha
  ),
  areas_dia as (
    select r.fecha, r.area from reclamos r
    where r.estado = 'ACTIVO' and r.fecha between $2 and $3
    group by r.fecha, r.area
  ),
  oc as (
    select c.dni, c.fecha, -sum(c.minutos) m from ocurrencias c
    where c.dni = any($1) and c.fecha between $2 and $3
      and c.minutos < 0 and c.tipo <> 'HORA_EXTRA'
    group by c.dni, c.fecha
  ),
  d as (select g::date fecha, _laborable(g::date) lab, _jornada(g::date) jor
          from generate_series($2, $3, interval '1 day') g)
  select o.dni, d.fecha,
    case
      when rec.dni is not null then 'ENTREGADO'
      when d.jor > 0 and coalesce(oc.m, 0) >= d.jor then 'ENTREGADO'
      when _ausente(a.estado) then 'AUSENTE'
      when not d.lab then 'SIN_LABOR'
      when d.fecha < coalesce(ini.f, _hoy()) then 'SIN_LABOR'
      when z1.area is null and z2.area is null then 'SIN_LABOR'
      else 'PENDIENTE'
    end
  from o cross join d
  left join ini on ini.dni = o.dni
  left join rec on rec.dni = o.dni and rec.fecha = d.fecha
  left join oc  on oc.dni  = o.dni and oc.fecha  = d.fecha
  left join asistencia a on a.dni = o.dni and a.fecha = d.fecha
  left join areas_dia z1 on z1.fecha = d.fecha and z1.area = o.area_actual
  left join areas_dia z2 on z2.fecha = d.fecha and z2.area = o.area_origen
  $q$ using p_dnis, p_desde, p_hasta;
end $function$;

create or replace function public._pcp_prod(p_desde date, p_hasta date)
 returns table(fecha date, area text, prendas numeric, minutos numeric)
 language sql stable security definer
 set search_path to 'public' set statement_timeout to '20s'
as $function$
  with g as materialized (
    select r.area, upper(trim(r.articulo)) art, r.nop, r.fecha, sum(r.cant) cant, sum(r.minutos) mins
      from reclamos r where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO' and r.nop is not null
     group by 1, 2, 3, 4),
  a as materialized (select distinct art, _nk(art) k from g),
  u as materialized (select distinct on (area, k) area, k, n2 from _ultimas(null)),
  s as materialized (select area, _nk(articulo) k, sum(std) sam from bases where n_op > 0 group by 1, 2),
  x as (
    select g.fecha, g.area, g.nop, g.cant, g.mins, u.k, u.n2, s.sam
      from g join a using (art)
      left join u on u.area = g.area and u.k = a.k
      left join s on s.area = g.area and s.k = u.k)
  select x.fecha, x.area,
         sum(case when x.k is not null and x.nop = x.n2 then x.cant else 0 end),
         round(sum(case when x.k is null then x.mins when x.nop = x.n2 then x.cant * coalesce(x.sam, 0) else 0 end), 2)
    from x group by x.fecha, x.area
$function$;

commit;
