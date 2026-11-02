-- PARCHE 162 — Última / penúltima por prenda y Cantidad por área con la penúltima
-- 1) En artículos con dos prendas en la misma BASE (p. ej. TE4563 en ACABADO:
--    SACO y PANTALON) la última y la penúltima se eligen POR PRENDA. Tabla
--    ultimas_prenda, igual a ultimas_articulo pero con la prenda en la llave.
-- 2) _ultimas_por_prenda(área): una fila por área × artículo × prenda. Si el
--    artículo tiene una sola prenda da lo mismo que _ultimas (usa
--    ultimas_articulo); si tiene varias, cada prenda con su propia regla:
--    mayor N°OP de esa prenda y el siguiente, o lo que fijó Ingeniería.
-- 3) fn_ultimas_prenda_area / fn_ultimas_prenda_guardar: lectura y guardado
--    para Bases › ★ ÚLTIMA / PENÚLTIMA (solo artículos con varias prendas).
-- 4) fn_cantidad_penultima: Dashboards › Cantidad por área con la PENÚLTIMA
--    operación, con detalle por prenda y artículo. fn_cantidad_areas (última)
--    se queda igual para los despliegues viejos.
-- _ultimas y ultimas_articulo no cambian: Costos, Tickets, Avance y Reporte de
-- hoy siguen igual.

begin;

-- 1) ------------------------------------------------------------------------
create table if not exists public.ultimas_prenda (
  area            text not null,
  articulo        text not null,          -- _nk(articulo)
  prenda          text not null,          -- _nk(prenda)
  op_ultima       bigint,                 -- bases.op_id
  op_penultima    bigint,
  nom_ultima      text,
  nom_penultima   text,
  actualizado_por text,
  actualizado     timestamptz not null default now(),
  primary key (area, articulo, prenda)
);
alter table public.ultimas_prenda enable row level security;
revoke all on public.ultimas_prenda from anon, authenticated;

-- 2) ------------------------------------------------------------------------
create or replace function public._ultimas_por_prenda(p_area text)
 returns table(area text, k text, articulo text, prenda text, pk text,
               n1 int, n2 int, auto1 int, auto2 int, manual boolean, multi boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  with a0 as (
    select b.area, b.articulo, b.prenda, max(b.n_op) a1 from bases b
     where (coalesce(p_area,'') = '' or b.area = p_area) and b.n_op > 0
     group by 1,2,3
  ), ag as (
    select a0.area, _nk(a0.articulo) k, _nk(a0.prenda) pk,
           min(upper(trim(a0.articulo))) art, min(upper(trim(coalesce(a0.prenda,'')))) pre, max(a0.a1) a1
      from a0 group by 1,2,3
  ), a as (
    select ag.*, count(*) over (partition by ag.area, ag.k) > 1 multi from ag
  ), x as (
    select a.*,
      case when a.multi then up.op_ultima    else ua.op_ultima    end op_u,
      case when a.multi then up.op_penultima else ua.op_penultima end op_p,
      case when a.multi then up.nom_ultima    else ua.nom_ultima    end nom_u,
      case when a.multi then up.nom_penultima else ua.nom_penultima end nom_p
      from a
      left join ultimas_articulo ua on not a.multi and ua.area = a.area and ua.articulo = a.k
      left join ultimas_prenda up on a.multi and up.area = a.area and up.articulo = a.k and up.prenda = a.pk
  ), m as materialized (
    select x.*,
      coalesce(
        (select b.n_op from bases b where b.op_id = x.op_u and b.area = x.area and _nk(b.articulo) = x.k
            and (not x.multi or _nk(b.prenda) = x.pk) and b.n_op > 0),
        (select max(b.n_op) from bases b where x.nom_u is not null and b.area = x.area and _nk(b.articulo) = x.k
            and (not x.multi or _nk(b.prenda) = x.pk) and _nk(b.operacion) = _nk(x.nom_u) and b.n_op > 0)) mu,
      coalesce(
        (select b.n_op from bases b where b.op_id = x.op_p and b.area = x.area and _nk(b.articulo) = x.k
            and (not x.multi or _nk(b.prenda) = x.pk) and b.n_op > 0),
        (select max(b.n_op) from bases b where x.nom_p is not null and b.area = x.area and _nk(b.articulo) = x.k
            and (not x.multi or _nk(b.prenda) = x.pk) and _nk(b.operacion) = _nk(x.nom_p) and b.n_op > 0)) mp
      from x
  )
  select m.area, m.k, m.art, m.pre, m.pk,
         coalesce(m.mu, m.a1),
         coalesce(m.mp, (select max(b.n_op) from bases b where b.area = m.area and _nk(b.articulo) = m.k
                           and (not m.multi or _nk(b.prenda) = m.pk)
                           and b.n_op > 0 and b.n_op < coalesce(m.mu, m.a1))),
         m.a1,
         (select max(b.n_op) from bases b where b.area = m.area and _nk(b.articulo) = m.k
             and (not m.multi or _nk(b.prenda) = m.pk) and b.n_op > 0 and b.n_op < m.a1),
         (m.mu is not null or m.mp is not null),
         m.multi
    from m
$function$;

revoke all on function public._ultimas_por_prenda(text) from public, anon, authenticated;

-- 3a) -----------------------------------------------------------------------
create or replace function public.fn_ultimas_prenda_area(p_dni text, p_token uuid, p_area text)
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform _lector(p_dni, p_token, p_area);
  return coalesce((select json_agg(json_build_object(
      'articulo', u.articulo, 'prenda', u.prenda, 'n1', u.n1, 'n2', u.n2,
      'auto1', u.auto1, 'auto2', u.auto2, 'manual', u.manual,
      'fija1', x.nom_ultima is not null, 'fija2', x.nom_penultima is not null,
      'por', x.actualizado_por,
      'cuando', to_char(x.actualizado at time zone 'America/Lima', 'DD/MM HH24:MI'))
      order by u.articulo, u.prenda)
    from _ultimas_por_prenda(p_area) u
    left join ultimas_prenda x on u.manual and x.area = u.area and x.articulo = u.k and x.prenda = u.pk
   where u.multi), '[]'::json);
end $function$;

revoke all on function public.fn_ultimas_prenda_area(text, uuid, text) from public;
grant execute on function public.fn_ultimas_prenda_area(text, uuid, text) to anon, authenticated;

-- 3b) -----------------------------------------------------------------------
create or replace function public.fn_ultimas_prenda_guardar(p_dni text, p_token uuid, p_area text,
  p_articulo text, p_prenda text, p_nop_ultima integer, p_nop_penultima integer)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_k text := _nk(p_articulo); v_pk text := _nk(p_prenda);
        a1 int; a2 int; v_multi boolean; bu bases; bp bases;
begin
  o := _lector(p_dni, p_token, p_area);
  if not coalesce(o.es_admin, false) and o.cargo <> 'INGENIERIA' then
    raise exception 'NO_AUTORIZADA'; end if;
  if coalesce(trim(p_area),'') = '' or v_k = '' then
    return json_build_object('ok', false, 'error', 'Indica el área y el artículo'); end if;

  select u.auto1, u.auto2, u.multi into a1, a2, v_multi
    from _ultimas_por_prenda(p_area) u where u.k = v_k and u.pk = v_pk;
  if a1 is null then
    return json_build_object('ok', false, 'error', 'Esa prenda no está en la BASE de ' || p_area); end if;
  if not v_multi then
    return json_build_object('ok', false, 'error', 'El artículo tiene una sola prenda: se elige por artículo'); end if;

  if p_nop_penultima = coalesce(p_nop_ultima, a1) then
    return json_build_object('ok', false, 'error', 'La última y la penúltima no pueden ser la misma operación'); end if;

  if p_nop_ultima is not null then
    select * into bu from bases b where b.area = p_area and _nk(b.articulo) = v_k
       and _nk(b.prenda) = v_pk and b.n_op = p_nop_ultima order by b.id limit 1;
    if not found then
      return json_build_object('ok', false, 'error', 'El N°OP ' || p_nop_ultima || ' no es de esa prenda'); end if;
  end if;
  if p_nop_penultima is not null then
    select * into bp from bases b where b.area = p_area and _nk(b.articulo) = v_k
       and _nk(b.prenda) = v_pk and b.n_op = p_nop_penultima order by b.id limit 1;
    if not found then
      return json_build_object('ok', false, 'error', 'El N°OP ' || p_nop_penultima || ' no es de esa prenda'); end if;
  end if;

  if (p_nop_ultima is null or p_nop_ultima = a1)
     and (p_nop_penultima is null or p_nop_penultima is not distinct from a2) then
    delete from ultimas_prenda where area = p_area and articulo = v_k and prenda = v_pk;
    return json_build_object('ok', true, 'manual', false);
  end if;

  insert into ultimas_prenda (area, articulo, prenda, op_ultima, op_penultima, nom_ultima, nom_penultima,
                              actualizado_por, actualizado)
  values (p_area, v_k, v_pk, bu.op_id, bp.op_id, bu.operacion, bp.operacion, o.dni, now())
  on conflict (area, articulo, prenda) do update set
    op_ultima = excluded.op_ultima, op_penultima = excluded.op_penultima,
    nom_ultima = excluded.nom_ultima, nom_penultima = excluded.nom_penultima,
    actualizado_por = excluded.actualizado_por, actualizado = excluded.actualizado;
  return json_build_object('ok', true, 'manual', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_ultimas_prenda_guardar(text, uuid, text, text, text, integer, integer) from public;
grant execute on function public.fn_ultimas_prenda_guardar(text, uuid, text, text, text, integer, integer) to anon, authenticated;

-- 4) ------------------------------------------------------------------------
-- Cantidad por área con la penúltima operación (si el artículo tiene una sola
-- operación, cuenta esa). Se agrupa primero por el texto crudo y luego _nk.
create or replace function public.fn_cantidad_penultima(p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
declare v json;
begin
  perform _lector(p_dni, p_token, '');
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    return json_build_object('ok', false, 'error', 'Rango inválido'); end if;
  if (p_hasta - p_desde) > 366 then return json_build_object('ok', false, 'error', 'Rango máximo 366 días'); end if;

  with u as materialized (
    select * from _ultimas_por_prenda('')
  ), r as (
    select r.area, r.articulo, r.nop, sum(r.cant) c from reclamos r
     where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO' and r.nop is not null
     group by 1,2,3
  ), r2 as materialized (
    select r.area, _nk(r.articulo) k, r.nop, sum(r.c) c from r group by 1,2,3
  ), ar as (
    select u.area, coalesce(nullif(u.prenda,''), 'SIN PRENDA') prenda, u.articulo, sum(r2.c) c
      from r2 join u on u.area = r2.area and u.k = r2.k and r2.nop = coalesce(u.n2, u.n1)
     group by 1,2,3
  ), pr as (
    select ar.area, ar.prenda, sum(ar.c) c,
           json_agg(json_build_object('articulo', ar.articulo, 'cantidad', round(ar.c, 0))
                    order by ar.c desc, ar.articulo) arts
      from ar group by 1,2
  ), aa as (
    select pr.area, sum(pr.c) c,
           json_agg(json_build_object('prenda', pr.prenda, 'cantidad', round(pr.c, 0), 'articulos', pr.arts)
                    order by pr.c desc, pr.prenda) prendas
      from pr group by 1
  )
  select coalesce(json_agg(json_build_object('area', aa.area, 'cantidad', round(aa.c, 0), 'prendas', aa.prendas)
                  order by aa.area), '[]'::json)
    into v from aa;
  return json_build_object('ok', true, 'nivel', 'penultima', 'areas', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_cantidad_penultima(text, uuid, date, date) from public;
grant execute on function public.fn_cantidad_penultima(text, uuid, date, date) to anon, authenticated;

commit;
