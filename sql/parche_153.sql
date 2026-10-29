-- PARCHE 153 — Corte: lo requerido sale del CORTE REAL de NOTI_CORTE
-- pcp_corte guarda la columna CORTE REAL; fn_pcp_cronos la usa como lo requerido de la OF (antes que el cronograma o el programa).
-- fn_pcp_corte_cargar acepta corte_real (los front viejos no lo mandan y queda vacío). Necesita el parche 152.
-- Rollback: parche_153_rollback.sql
begin;

alter table public.pcp_corte add column if not exists corte_real numeric;

create or replace function public.fn_pcp_corte_cargar(p_dni text, p_token uuid, p_origen text, p_filas jsonb)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare o operarios; v_n int; v_d date; v_h date;
begin
  o := _pcp_editor(p_dni, p_token);
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'No hay filas de corte con fecha y cantidad');
  end if;
  if jsonb_array_length(p_filas) > 20000 then
    return json_build_object('ok', false, 'error', 'Máximo 20000 filas por carga: elige un rango de fechas más corto');
  end if;
  select min((x->>'fecha')::date), max((x->>'fecha')::date) into v_d, v_h from jsonb_array_elements(p_filas) x;
  delete from pcp_corte where fecha between v_d and v_h;
  insert into pcp_corte (fecha, o_f, articulo, color, cliente, cantidad, corte_real)
  select (x->>'fecha')::date, nullif(trim(x->>'of'), ''), upper(trim(x->>'articulo')), nullif(trim(x->>'color'), ''),
         nullif(trim(x->>'cliente'), ''), (x->>'cantidad')::numeric, nullif(x->>'corte_real', '')::numeric
    from jsonb_array_elements(p_filas) x
   where nullif(x->>'fecha', '') is not null and coalesce(nullif(x->>'cantidad', '')::numeric, 0) <> 0;
  get diagnostics v_n = row_count;
  insert into pcp_cargas (tipo, archivo, filas, desde, hasta, cargado_por, cargado_en)
  values ('CORTE', left(p_origen, 300), v_n, v_d, v_h, o.dni, now())
  on conflict (tipo) do update set archivo = excluded.archivo, filas = excluded.filas, desde = excluded.desde,
    hasta = excluded.hasta, cargado_por = excluded.cargado_por, cargado_en = excluded.cargado_en;
  return json_build_object('ok', true, 'filas', v_n, 'desde', v_d, 'hasta', v_h);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_pcp_cronos(p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare v_hoy date := _hoy(); v_corte json; v_sem json; v_of json; v_cap json;
begin
  perform _vista(p_dni, p_token, array['pasoPcp']);
  if p_hasta < p_desde or p_hasta - p_desde > 120 then return json_build_object('ok', false, 'error', 'Rango inválido (máximo 4 meses)'); end if;

  /* Corte → costura: disponible solo con el corte completo. */
  with req as (
    select _of_planta(o_f) o, max(articulo) art, max(cliente) cli, sum(cantidad) cant, min(ini_costura) ini_cos, max(fin_corte) fin_corte
      from pcp_cronograma where _of_planta(o_f) is not null group by 1),
  prog as (select _of_planta(o_f) o, max(articulo) art, max(cliente) cli, sum(cant_prog) cant, min(ini_costura) ini_cos, max(area) area
             from pcp_programa where _of_planta(o_f) is not null group by 1),
  k as (select o_f o, fecha, sum(cantidad) c from pcp_corte group by 1, 2),
  cre as (select o_f o, max(corte_real) cr from pcp_corte where corte_real > 0 group by 1),
  ac as (select o, fecha, sum(c) over (partition by o order by fecha) acum from k),
  todas as (select o from k where fecha >= p_desde - 60 union select o from prog where ini_cos between p_desde - 15 and p_hasta union select o from req where ini_cos between p_desde - 15 and p_hasta),
  t as (
    select t.o, coalesce(req.art, prog.art, f.articulo) art, coalesce(req.cli, prog.cli) cli, prog.area,
           coalesce(cre.cr, req.cant, prog.cant, f.cant_prog) req, coalesce(req.ini_cos, prog.ini_cos) ini_cos, req.fin_corte,
           (select max(acum) from ac where ac.o = t.o) cortado,
           (select min(fecha) from ac where ac.o = t.o) primero
      from todas t left join cre using (o) left join req using (o) left join prog using (o) left join ofs f on f.o_f = t.o)
  select coalesce(json_agg(json_build_object('o_f', o, 'articulo', art, 'cliente', cli, 'area', area, 'requerido', req, 'cortado', coalesce(cortado, 0),
           'primero', primero, 'ini_costura', ini_cos, 'fin_corte', fin_corte,
           'completo', (select min(fecha) from ac where ac.o = t.o and req > 0 and ac.acum >= req),
           'estado', case when req > 0 and coalesce(cortado, 0) >= req then 'DISPONIBLE' when coalesce(cortado, 0) > 0 then 'INCOMPLETO' else 'SIN CORTE' end)
         order by o), '[]'::json) into v_corte from t;

  /* Lo que llega a ACABADO: penúltima operación de costura. */
  with r as materialized (
    select r.area, r.o_f, upper(trim(r.articulo)) art, r.nop, r.fecha, sum(r.cant) cant
      from reclamos r where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO' and r.area like '%COSTURA' and r.nop is not null
     group by 1, 2, 3, 4, 5),
  a as materialized (select distinct art, _nk(art) k from r),
  u as materialized (select distinct on (area, k) area, k, n2 from _ultimas(null)),
  sam as materialized (select _nk(articulo) k, sum(std) sam, max(prenda) prenda from bases where area = 'ACABADO' and n_op > 0 group by 1),
  pr as (select o_f, max(prenda) prenda from ofs group by 1),
  ll as (
    select r.o_f, r.art, a.k, r.fecha, sum(r.cant) prendas
      from r join a using (art) join u on u.area = r.area and u.k = a.k and u.n2 = r.nop group by 1, 2, 3, 4),
  x as (select ll.*, _acab_sub(coalesce(pr.prenda, s.prenda)) sub, s.sam, date_trunc('week', ll.fecha)::date sem
          from ll left join pr using (o_f) left join sam s on s.k = ll.k),
  h as materialized (
    select r.o_f, r.fecha, date_trunc('week', r.fecha)::date sem, _acab_sub(coalesce(pr.prenda, s.prenda)) sub, sum(r.minutos) mins
      from reclamos r left join pr using (o_f) left join sam s on s.k = _nk(r.articulo)
     where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO' and r.area = 'ACABADO'
     group by 1, 2, 3, 4),
  dias as (select d::date f, date_trunc('week', d)::date sem from generate_series(p_desde, p_hasta, '1 day') d),
  cap as (
    select dias.sem, sum(_jornada(dias.f) * (select count(*) from estructura_mes e
             where e.mes = date_trunc('month', dias.f)::date and e.area = 'ACABADO' and e.tipo = 'MOD'
               and (e.desde is null or e.desde <= dias.f) and (e.hasta is null or e.hasta >= dias.f))) cap
      from dias group by 1),
  sems as (select sem from dias group by 1)
  select json_agg(json_build_object('ini', s.sem, 'fin', s.sem + 6, 'capacidad', coalesce(c.cap, 0),
           'llega', (select coalesce(json_object_agg(sub, m), '{}'::json) from (select sub, round(sum(prendas * coalesce(sam, 0))) m from x where x.sem = s.sem group by 1) q),
           'prendas', (select coalesce(json_object_agg(sub, p), '{}'::json) from (select sub, sum(prendas) p from x where x.sem = s.sem group by 1) q),
           'hecho', (select coalesce(json_object_agg(sub, m), '{}'::json) from (select sub, round(sum(mins)) m from h where h.sem = s.sem group by 1) q))
         order by s.sem)
    into v_sem from sems s left join cap c using (sem);

  with r as materialized (
    select r.area, r.o_f, upper(trim(r.articulo)) art, r.nop, r.fecha, sum(r.cant) cant
      from reclamos r where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO' and r.area like '%COSTURA' and r.nop is not null
     group by 1, 2, 3, 4, 5),
  a as materialized (select distinct art, _nk(art) k from r),
  u as materialized (select distinct on (area, k) area, k, n2 from _ultimas(null)),
  sam as materialized (select _nk(articulo) k, sum(std) sam, max(prenda) prenda from bases where area = 'ACABADO' and n_op > 0 group by 1),
  pr as (select o_f, max(prenda) prenda from ofs group by 1),
  ll as (
    select r.o_f, max(r.art) art, a.k, min(r.fecha) ini, max(r.fecha) fin, sum(r.cant) prendas
      from r join a using (art) join u on u.area = r.area and u.k = a.k and u.n2 = r.nop group by 1, 3),
  h as (select o_f, min(fecha) ini, max(fecha) fin, sum(minutos) mins from reclamos
         where fecha between p_desde and p_hasta and estado = 'ACTIVO' and area = 'ACABADO' group by 1)
  select coalesce(json_agg(json_build_object('o_f', ll.o_f, 'articulo', ll.art, 'sub', _acab_sub(coalesce(pr.prenda, s.prenda)),
           'prendas', ll.prendas, 'minutos', round(ll.prendas * coalesce(s.sam, 0)), 'sin_base', s.sam is null,
           'llega_ini', ll.ini, 'llega_fin', ll.fin, 'acab_ini', h.ini, 'acab_fin', h.fin, 'hecho', round(coalesce(h.mins, 0)))
         order by ll.o_f), '[]'::json)
    into v_of from ll left join pr using (o_f) left join sam s on s.k = ll.k left join h using (o_f);

  return json_build_object('ok', true, 'hoy', v_hoy, 'desde', p_desde, 'hasta', p_hasta,
    'corte', v_corte, 'semanas', coalesce(v_sem, '[]'::json), 'ofs', v_of);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
