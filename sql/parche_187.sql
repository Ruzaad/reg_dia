-- PARCHE 187 — PCP: columnas Corte, Costura y Acabado con su % y detalle por módulo al tocar el %.
-- Solo lectura, no crea tablas.
-- 1) fn_pcp_etapas: % de Corte y de Acabado de todas las OF del mes en UNA consulta (Costura ya viene en fn_pcp_costura.status).
--    Corte = salida de corte / programado. Acabado = prendas de la penúltima operación de ACABADO / prendas de costura (misma regla del parche 181).
-- 2) fn_pcp_etapa_detalle: módulos y operaciones (inicio, final, prendas) de una etapa de una OF; se pide solo al abrir el modal.
--    El % sale de la penúltima operación (_ultimas.n2). Corte aún no tiene módulos: se muestra por fecha de salida.
-- Rollback: parche_187_rollback.sql
begin;

create or replace function public.fn_pcp_etapas(p_dni text, p_token uuid, p_mes date default null)
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  o operarios; v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_d date; v_h date; j json;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  v_d := date_trunc('week', v_mes)::date;
  v_h := (date_trunc('week', (v_mes + interval '1 month - 1 day')::date) + interval '6 days')::date;
  with pr as (
    select p.o_f, _of_planta(p.o_f) ofp, p.area, _nk(p.articulo) k, sum(p.cant_prog) cant
      from pcp_programa p
     where p.area like '%COSTURA' and p.o_f is not null
       and (p.ini_costura between v_d and v_h or (p.ini_costura is null and v_mes = date_trunc('month', _hoy())::date))
     group by 1, 2, 3, 4),
  fo as (select distinct ofp from pr),
  co as (select _of_planta(c.o_f) ofp, sum(c.cantidad) hecho from pcp_corte c group by 1),
  ua as (select k, n2 from _ultimas('ACABADO') where n2 is not null),
  acn as (select distinct pr.ofp, ua.n2 from pr join ua on ua.k = pr.k),
  ac as (select a.ofp, sum(r.cant) hecho
           from acn a join reclamos r on r.o_f = a.ofp and r.area = 'ACABADO' and r.estado = 'ACTIVO' and r.nop = a.n2
          group by 1),
  pa as (select ofp, area, sum(cant) cant from pr group by 1, 2),
  me as (select pa.ofp, max(pa.cant) corte_meta, sum(coalesce(nullif(co.hecho, 0), pa.cant)) costura_meta
           from pa left join co on co.ofp = pa.ofp group by 1)
  select coalesce(json_object_agg(x.o_f, json_build_object(
      'corte', case when co.hecho > 0 and me.corte_meta > 0 then round(least(100, co.hecho / me.corte_meta * 100)) end,
      'acabado', case when ac.hecho > 0 and me.costura_meta > 0 then round(least(100, ac.hecho / me.costura_meta * 100)) end)), '{}'::json)
    into j
    from (select distinct o_f, ofp from pr) x
    left join me on me.ofp = x.ofp left join co on co.ofp = x.ofp left join ac on ac.ofp = x.ofp;
  return json_build_object('ok', true, 'etapas', j);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_pcp_etapas(text, uuid, date) from public;
grant execute on function public.fn_pcp_etapas(text, uuid, date) to anon, authenticated;

create or replace function public.fn_pcp_etapa_detalle(p_dni text, p_token uuid, p_of text, p_etapa text, p_area text default null)
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  o operarios; v text := _of_planta(p_of); e text := upper(coalesce(p_etapa, ''));
  a text; v_meta numeric; v_cort numeric; j json;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  if v is null then return json_build_object('ok', false, 'error', 'OF sin número'); end if;
  select sum(cantidad) into v_cort from pcp_corte where _of_planta(o_f) = v;

  if e = 'CORTE' then
    select coalesce(max(s), 0) into v_meta
      from (select sum(cant_prog) s from pcp_programa where area like '%COSTURA' and _of_planta(o_f) = v group by area) z;
    select json_build_object('ok', true, 'etapa', 'CORTE', 'meta', v_meta, 'hecho', coalesce(v_cort, 0), 'pen_n', null,
      'mods', case when v_cort is null then '[]'::json else json_build_array(json_build_object(
        'mod', 'CORTE', 'hecho', v_cort, 'ini', min(fecha), 'fin', max(fecha),
        'ops', (select json_agg(json_build_object('n', null, 'op', 'Salida de corte', 'hecho', c.s, 'ini', c.f, 'fin', c.f, 'pen', false) order by c.f)
                  from (select fecha f, sum(cantidad) s from pcp_corte where _of_planta(o_f) = v group by 1) c))) end)
      into j from pcp_corte where _of_planta(o_f) = v;
    return coalesce(j, json_build_object('ok', true, 'etapa', 'CORTE', 'meta', v_meta, 'hecho', 0, 'mods', '[]'::json));
  end if;

  if e = 'ACABADO' then
    a := 'ACABADO';
    select coalesce(sum(coalesce(nullif(v_cort, 0), s)), 0) into v_meta
      from (select sum(cant_prog) s from pcp_programa where area like '%COSTURA' and _of_planta(o_f) = v group by area) z;
  else
    a := upper(coalesce(p_area, ''));
    select coalesce(nullif(v_cort, 0), sum(cant_prog)) into v_meta from pcp_programa where area = a and _of_planta(o_f) = v;
  end if;

  with b as (select * from _avance_of_base(a, v, null)),
  u as (select k, n2 from _ultimas(a)),
  d as (select coalesce(nullif(trim(r.modulo), ''), '(sin módulo)') modulo, r.nop, min(r.fecha) ini, max(r.fecha) fin
          from reclamos r where r.o_f = v and r.area = a and r.estado = 'ACTIVO' group by 1, 2),
  t as (select b.modulo, b.n_op, b.operacion, b.producida, d.ini, d.fin, (u.n2 is not null and b.n_op = u.n2) pen
          from b left join u on u.k = _nk(b.articulo) left join d on d.modulo = b.modulo and d.nop = b.n_op),
  m as (select t.modulo, count(*) total, count(*) filter (where producida > 0) con, min(ini) ini, max(fin) fin,
               coalesce(sum(producida) filter (where pen), 0) hecho,
               json_agg(json_build_object('n', n_op, 'op', operacion, 'hecho', producida, 'ini', ini, 'fin', fin, 'pen', pen) order by n_op) ops
          from t group by 1)
  select json_build_object('ok', true, 'etapa', e, 'area', a, 'meta', v_meta,
      'hecho', coalesce((select sum(hecho) from m), 0),
      'pen_n', (select min(n_op) from t where pen),
      'mods', coalesce((select json_agg(json_build_object('mod', modulo, 'total', total, 'con', con, 'ini', ini, 'fin', fin, 'hecho', hecho, 'ops', ops) order by ini nulls last, modulo) from m), '[]'::json))
    into j;
  return j;
end $function$;

revoke all on function public.fn_pcp_etapa_detalle(text, uuid, text, text, text) from public;
grant execute on function public.fn_pcp_etapa_detalle(text, uuid, text, text, text) to anon, authenticated;

commit;
