-- PARCHE 186 — Asistente CHRONOS: avance de una OF por etapa (corte, costura, acabado) con la operación pedida.
-- Solo lectura, sin tablas nuevas. Por defecto toma la PENÚLTIMA operación de cada área (prendas reales);
-- con p_n_op calcula con esa operación. Mide ~150 ms (no recorre reclamos: las áreas salen de bases).
-- Rollback: parche_186_rollback.sql
begin;

create or replace function public.fn_asistente_avance_of(
  p_dni text, p_token uuid, p_of text, p_n_op integer default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o ofs; c json; v json;
begin
  perform _lector(p_dni, p_token, '');
  select * into o from ofs where _nk(o_f) = _nk(p_of) limit 1;
  if not found then return json_build_object('ok', false, 'error', 'OF no registrada'); end if;

  select json_build_object('programado', round(sum(cantidad)), 'real', round(sum(corte_real)))
    into c from pcp_corte where _nk(o_f) = _nk(o.o_f) having count(*) > 0;

  with ar as (
    select distinct b.area from bases b where _nk(b.articulo) = _nk(o.articulo) and b.area <> 'UDP'
  ), u as materialized (
    select * from _ultimas_por_prenda('') where _nk(articulo) = _nk(o.articulo)
  ), x as (
    select a.area, b.n_op, b.operacion, b.producida,
           coalesce(p_n_op, u.n2, u.n1) pedida, u.n2 pen, u.n1 ult
      from ar a cross join lateral _avance_of_base(a.area, o.o_f, null) b
      left join u on u.area = a.area
  )
  select coalesce(json_agg(z.j order by z.area), '[]'::json) into v
    from (select area, json_build_object(
           'area', area, 'n_op', max(pedida), 'operacion', max(operacion) filter (where n_op = pedida),
           'prendas', round(coalesce(sum(producida) filter (where n_op = pedida), 0)),
           'penultima', max(pen), 'ultima', max(ult),
           'ultima_prendas', round(coalesce(sum(producida) filter (where n_op = ult), 0)),
           'con_registros', coalesce(sum(producida), 0) > 0) j
            from x group by area) z;
  return json_build_object('ok', true, 'of', o.o_f, 'articulo', o.articulo, 'cant_prog', round(o.cant_prog),
                           'corte', c, 'areas', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
