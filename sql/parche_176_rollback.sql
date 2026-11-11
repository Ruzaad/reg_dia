-- Deshace el parche 176: vuelve fn_acabado_ofs a la versión anterior
begin;

CREATE OR REPLACE FUNCTION public.fn_acabado_ofs(p_dni text, p_token uuid, p_area text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
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
  ult as (
    select _nk(r.o_f) ko, max(r.creado) u
    from reclamos r
    where r.area = p_area and r.dni = o.dni and r.estado = 'ACTIVO'
    group by 1
  ),
  ops as (
    select f.o_f, ru.n_op, ru.modulo, ru.operacion, ru.std, ru.prenda, f.cant_prog,
           round(coalesce(h.c,0),0) hecho, round(coalesce(h.mio,0),0) mio
    from ofs f
    join rutas ru on ru.ka = _nk(f.articulo)
    left join hecho h on h.ko = _nk(f.o_f) and h.nop = ru.n_op
    where f.reproceso_cerrado is null
  ),
  porof as (
    select op.o_f,
           json_agg(json_build_object('n_op', op.n_op, 'modulo', op.modulo,
             'operacion', op.operacion, 'std', op.std, 'prenda', op.prenda,
             'hecho', op.hecho, 'mio', op.mio) order by op.n_op) operaciones
    from ops op
    group by op.o_f
    having bool_or(op.hecho < op.cant_prog)
  ),
  pren as (
    select p.o_f, json_agg(p.prenda order by p.n1) prendas
    from (select op.o_f, op.prenda, min(op.n_op) n1
            from ops op where op.prenda <> '' group by 1,2) p
    group by p.o_f
  ),
  col as (
    select d.o_f, string_agg(distinct d.color, ' / ') colores
    from of_detalle d join porof p on p.o_f = d.o_f
    where d.color is not null
    group by d.o_f
  )
  select coalesce(json_agg(json_build_object(
      'of', f.o_f, 'articulo', f.articulo, 'prenda', f.prenda,
      'cant_prog', f.cant_prog, 'colores', coalesce(c.colores, ''),
      'prendas', coalesce(pr.prendas, '[]'::json), 'operaciones', p.operaciones)
      order by u.u desc nulls last, f.o_f), '[]'::json)
    into v
  from ofs f
  join porof p on p.o_f = f.o_f
  left join pren pr on pr.o_f = f.o_f
  left join col c on c.o_f = f.o_f
  left join ult u on u.ko = _nk(f.o_f);

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
