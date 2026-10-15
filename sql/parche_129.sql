-- PARCHE 129 — Vista de REPROCESO: abrir, cerrar y ver el progreso de los lotes
-- Un lote de REPROCESO es una OF provisional (ofs.reproceso, parche 126). Se agrega la
-- marca de cerrado: un lote cerrado deja de salirle al operario en su lista de OFs.
-- Ingeniería y supervisión (con acceso a REPROCESO) ven todos los lotes con el avance por
-- operación, las personas, los minutos y lo reclasificado, y los abren o cierran.
-- fn_acabado_ofs: igual que producción, más "no cerrado". Rollback: parche_129_rollback.sql
begin;

alter table public.ofs add column if not exists reproceso_cerrado timestamptz;
alter table public.ofs add column if not exists reproceso_cerrado_por text;

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
  /* Última vez que este operario trabajó cada OF: una sola pasada, no una por OF. */
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
  /* Solo las OFs con alguna operación pendiente. */
  porof as (
    select op.o_f,
           json_agg(json_build_object('n_op', op.n_op, 'modulo', op.modulo,
             'operacion', op.operacion, 'std', op.std, 'prenda', op.prenda,
             'hecho', op.hecho, 'mio', op.mio) order by op.n_op) operaciones
    from ops op
    group by op.o_f
    having bool_or(op.hecho < op.cant_prog)
  ),
  /* Las prendas de trabajo de cada OF, en el orden de la ruta. */
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

-- Todos los lotes de REPROCESO con su avance por operación.
create or replace function public.fn_reproceso_lotes(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  if not _lote_permiso(o, 'REPROCESO', false) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a REPROCESO'; end if;
  return json_build_object('ok', true, 'edita', _lote_permiso(o, 'REPROCESO', true),
    'lotes', coalesce((
      with h as (
        select _nk(r.o_f) ko, r.nop, sum(r.cant) c, sum(r.minutos) mn, max(r.creado) ult
          from reclamos r where r.area = 'REPROCESO' and r.estado = 'ACTIVO' and r.o_f is not null group by 1,2
      ), rec as (
        select o_f, sum(cantidad) c from reproceso_reclasif where estado = 'ACTIVO' group by 1
      ), l as (
        select f.*, (select json_agg(json_build_object('n_op', ru.n_op, 'operacion', ru.operacion,
                        'hecho', round(coalesce(h.c, 0), 0)) order by ru.n_op)
                       from (select distinct on (b.n_op) b.n_op, b.operacion from bases b
                              where b.area = 'REPROCESO' and _nk(b.articulo) = _nk(f.articulo) and coalesce(b.n_op, 0) > 0
                              order by b.n_op, b.id) ru
                       left join h on h.ko = _nk(f.o_f) and h.nop = ru.n_op) ops
          from ofs f where f.reproceso
      )
      select json_agg(json_build_object('of', l.o_f, 'articulo', l.articulo, 'cant_prog', l.cant_prog,
          'creado', l.fecha_carga, 'cerrado', l.reproceso_cerrado is not null, 'cerrado_el', l.reproceso_cerrado,
          'ops', coalesce(l.ops, '[]'::json),
          'minutos', (select coalesce(sum(h.mn), 0) from h where h.ko = _nk(l.o_f)),
          'personas', (select count(distinct r.dni) from reclamos r where r.area = 'REPROCESO' and r.estado = 'ACTIVO' and _nk(r.o_f) = _nk(l.o_f)),
          'ultimo', (select max(h.ult) from h where h.ko = _nk(l.o_f)),
          'reclasificado', coalesce((select c from rec where rec.o_f = l.o_f), 0))
        order by (l.reproceso_cerrado is not null), l.fecha_carga desc nulls last, l.o_f)
      from l), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_lotes(text, uuid) to anon, authenticated;

-- Cerrar (p_cerrar = true) o reabrir un lote.
create or replace function public.fn_reproceso_lote_estado(p_dni text, p_token uuid, p_of text, p_cerrar boolean)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; n int;
begin
  o := _auth(p_dni, p_token);
  if not _lote_permiso(o, 'REPROCESO', true) then raise exception 'NO_AUTORIZADA_AREA: no puedes abrir ni cerrar lotes de REPROCESO'; end if;
  update ofs set reproceso_cerrado = case when p_cerrar then now() end,
                 reproceso_cerrado_por = case when p_cerrar then o.dni end
   where reproceso and _nk(o_f) = _nk(p_of);
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', false, 'error', 'Ese lote no es de REPROCESO'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_lote_estado(text, uuid, text, boolean) to anon, authenticated;

commit;
