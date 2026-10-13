-- ROLLBACK PARCHE 124 — vuelve fn_acabado_ofs a la versión anterior y quita el índice.
begin;

drop index if exists public.reclamos_area_of_cod_activo;

create or replace function public.fn_acabado_ofs(p_dni text, p_token uuid, p_area text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare o operarios; v json;
begin
  o := _auth(p_dni, p_token);

  with rutas as (
    select distinct on (_nk(b.articulo), b.n_op)
           _nk(b.articulo) ka, b.n_op, b.modulo, b.operacion, b.std,
           coalesce(nullif(upper(trim(b.prenda)),''),'') prenda
    from bases b
    where b.area = p_area and coalesce(b.n_op,0) > 0
    order by _nk(b.articulo), b.n_op, b.id
  ),
  hecho as (
    select _nk(r.o_f) ko, r.nop,
           sum(r.cant) c,
           sum(r.cant) filter (where r.dni = o.dni) mio
    from reclamos r
    where r.area = p_area and r.estado = 'ACTIVO' and r.o_f is not null
    group by 1,2
  ),
  ops as (
    select f.o_f, ru.n_op, ru.modulo, ru.operacion, ru.std, ru.prenda, f.cant_prog,
           round(coalesce(h.c,0),0) hecho, round(coalesce(h.mio,0),0) mio
    from ofs f
    join rutas ru on ru.ka = _nk(f.articulo)
    left join hecho h on h.ko = _nk(f.o_f) and h.nop = ru.n_op
  )
  select coalesce(json_agg(json_build_object(
      'of', x.o_f, 'articulo', x.articulo, 'prenda', x.prenda,
      'cant_prog', x.cant_prog, 'colores', x.colores,
      'prendas', x.prendas, 'operaciones', x.operaciones)
      order by x.ult_mio desc nulls last, x.o_f), '[]'::json)
    into v
  from (
    select f.o_f, f.articulo, f.prenda, f.cant_prog,
      (select coalesce(string_agg(distinct d.color, ' / '), '')
         from of_detalle d where d.o_f = f.o_f and d.color is not null) colores,
      /* Las prendas de trabajo de esta OF, en el orden de la ruta. */
      (select coalesce(json_agg(p.prenda order by p.n1), '[]'::json)
         from (select op.prenda, min(op.n_op) n1
                 from ops op where op.o_f = f.o_f and op.prenda <> ''
                group by op.prenda) p) prendas,
      (select json_agg(json_build_object('n_op', op.n_op, 'modulo', op.modulo,
              'operacion', op.operacion, 'std', op.std, 'prenda', op.prenda,
              'hecho', op.hecho, 'mio', op.mio) order by op.n_op)
         from ops op where op.o_f = f.o_f) operaciones,
      (select max(r.creado) from reclamos r
         where r.area = p_area and _nk(r.o_f) = _nk(f.o_f) and r.dni = o.dni and r.estado='ACTIVO') ult_mio
    from ofs f
    where exists (select 1 from rutas ru where ru.ka = _nk(f.articulo))
      and exists (select 1 from ops op where op.o_f = f.o_f and op.hecho < f.cant_prog)
  ) x;

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
