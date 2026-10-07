-- PARCHE 105 — Revisión de datos al cargar OFs y HN
-- 1) fn_of_revisar_articulo: qué BASE tiene un artículo en cada área (operaciones,
--    cuántas sin STD y con qué prenda), para revisar la HN ANTES de registrarla.
-- 2) fn_ofs_listar: cada área trae además `sin_std` (operaciones de la BASE con
--    STD vacío o en 0). Campo nuevo: el front anterior lo ignora.
-- Solo lectura. No cambia tablas ni lo que se registra.
begin;

create or replace function public.fn_of_revisar_articulo(p_dni text, p_token uuid, p_articulo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform _lector(p_dni, p_token, '');
  return json_build_object('ok', true, 'areas', coalesce((select json_agg(json_build_object(
      'area', x.area, 'ops', x.ops, 'sin_std', x.sin_std, 'prendas', x.prendas) order by x.area)
    from (select b.area, count(*) ops,
                 count(*) filter (where coalesce(b.std,0) <= 0) sin_std,
                 array_remove(array_agg(distinct nullif(upper(trim(b.prenda)),'')), null) prendas
            from bases b
           where _nk(b.articulo) = _nk(p_articulo) and coalesce(b.n_op,0) > 0
           group by b.area) x), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_of_revisar_articulo(text, uuid, text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_ofs_listar(p_dni text, p_token uuid, p_buscar text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
begin
  perform _lector(p_dni, p_token, '');
  return coalesce((select json_agg(json_build_object(
      'of', o.o_f, 'articulo', o.articulo, 'prenda', o.prenda,
      'cant_prog', o.cant_prog,
      'div_ultima', o.div_ultima_n, 'div_penultima', o.div_penultima_n,
      'fecha_carga', to_char(o.fecha_carga at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'cargado_por', o.cargado_por,
      'paquetes', (select count(*) from of_detalle d where d.o_f = o.o_f),
      'prendas', coalesce((select json_agg(json_build_object(
             'prenda', p.prenda, 'paquetes', p.paquetes, 'und', p.und)
             order by p.prenda)
           from (select d.prenda, count(*) paquetes, sum(d.cant) und
                   from of_detalle d where d.o_f = o.o_f
                  group by d.prenda) p), '[]'::json),
      /* Estado por área habilitada: si hay BASE del artículo, cuántas de sus
         operaciones no tienen STD (parche 105) y si la OF ya se generó ahí. */
      'areas', coalesce((select json_agg(json_build_object(
             'area', ac.area,
             'base', exists (select 1 from bases b
                              where b.area = ac.area
                                and _nk(b.articulo) = _nk(o.articulo)
                                and coalesce(b.n_op,0) > 0),
             'sin_std', (select count(*) from bases b
                          where b.area = ac.area
                            and _nk(b.articulo) = _nk(o.articulo)
                            and coalesce(b.n_op,0) > 0
                            and coalesce(b.std,0) <= 0),
             'generada', exists (select 1 from of_generada g
                                  where g.o_f = o.o_f and g.area = ac.area),
             'acabado', (_nk(ac.area) = _nk('ACABADO')))
             order by ac.area)
           from areas_config ac), '[]'::json),
      'detalle', coalesce((select json_agg(json_build_object(
           'prenda', d.prenda, 'talla', d.talla, 'color', d.color,
           'cant', d.cant, 'desde', d.desde, 'hasta', d.hasta)
           order by d.prenda, d.paq)
         from of_detalle d where d.o_f = o.o_f), '[]'::json))
      order by o.fecha_carga desc)
    from ofs o
    where coalesce(trim(p_buscar),'') = ''
       or _nk(o.o_f) like '%'||_nk(p_buscar)||'%'
       or _nk(o.articulo) like '%'||_nk(p_buscar)||'%'), '[]'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
