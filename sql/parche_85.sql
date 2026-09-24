-- PARCHE 85 — Supervisora · AVANCE OF y BASES
-- Dos pestañas nuevas del celular de la supervisora, de solo lectura:
--
-- AVANCE OF (fn_avance_of): las OF abiertas del área con sus módulos y
--   operaciones. Mismo cálculo que el "Resumen de OF" de Ingeniería
--   (fn_of_trazabilidad), pero recortado a UNA área y solo a las OF que se
--   movieron en los últimos 30 días, para que la consulta de cada minuto sea
--   liviana. La referencia del módulo es su última operación de la ruta BASE;
--   el % de la OF es el promedio del % de sus módulos. Una OF sale de la lista
--   cuando todos sus módulos del área están completos (o cerrados a mano).
--
-- BASES (fn_bases_area_articulos, fn_bases_area_ops): los artículos del área
--   con su STD total y, al abrir uno, sus operaciones por módulo. La lista
--   viaja sin operaciones (SACO tiene más de 11 000 filas en bases); cada
--   artículo se pide recién cuando la supervisora lo abre.
--
-- fn_avance_area se queda: la usan Ingeniería y los despliegues sin migrar.
-- Ninguna tabla cambia.

-- Una fila por operación de cada módulo: la ruta BASE del módulo más lo
-- reclamado con un N°OP que la BASE no tiene, con lo producido en cada una.
-- Sin p_of: las OF del área con tickets en los últimos 30 días.
create or replace function public._avance_of_base(p_area text, p_of text, p_modulo text)
 returns table(o_f text, modulo text, articulo text, cant_prog numeric,
               entrada timestamptz, ultimo timestamptz,
               n_op int, operacion text, producida numeric)
 language plpgsql stable
 set search_path to 'public'
as $function$
begin
  return query
  with cand as (
    select distinct r.o_f from reclamos r
     where p_of is null and r.area = p_area and r.estado = 'ACTIVO' and r.fecha >= _hoy() - 30
    union
    select p_of where p_of is not null
  ),
  rec as materialized (
    select r.o_f, coalesce(nullif(trim(r.modulo),''),'(sin módulo)') modulo,
           nullif(trim(r.articulo),'') articulo, r.nop, r.op, r.cant, r.creado
      from reclamos r
     where r.area = p_area and r.estado = 'ACTIVO' and r.o_f in (select c.o_f from cand c)
  ),
  mods as materialized (
    select m.o_f, m.modulo, f.cant_prog, coalesce(m.articulo, f.articulo) articulo,
           m.entrada, m.ultimo,
           _nk(coalesce(m.articulo, f.articulo)) ka, _nk(m.modulo) km
      from (select r.o_f, r.modulo, max(r.articulo) articulo,
                   min(r.creado) entrada, max(r.creado) ultimo
              from rec r
             where p_modulo is null or r.modulo = p_modulo
             group by r.o_f, r.modulo) m
      join ofs f on _nk(f.o_f) = _nk(m.o_f)
  ),
  prodop as materialized (
    select r.o_f, r.modulo, r.nop, max(r.op) op, sum(r.cant) producida
      from rec r
     where r.nop is not null and (p_modulo is null or r.modulo = p_modulo)
     group by r.o_f, r.modulo, r.nop
  ),
  ba as materialized (
    -- _nk una sola vez por fila de BASE, no una vez por módulo.
    select _nk(b.articulo) ka, _nk(b.modulo) km, b.n_op, b.operacion, b.id
      from bases b
     where b.area = p_area and coalesce(b.n_op,0) > 0
       and _nk(b.articulo) in (select distinct m.ka from mods m)
  ),
  ruta as (
    select distinct on (m.o_f, m.modulo, b.n_op) m.o_f, m.modulo, b.n_op, b.operacion
      from mods m join ba b on b.ka = m.ka and b.km = m.km
     order by m.o_f, m.modulo, b.n_op, b.id
  ),
  ops as (
    select r.o_f, r.modulo, r.n_op, r.operacion from ruta r
    union all
    select p.o_f, p.modulo, p.nop, p.op from prodop p
     where not exists (select 1 from ruta r
                        where r.o_f = p.o_f and r.modulo = p.modulo and r.n_op = p.nop)
  )
  select m.o_f, m.modulo, m.articulo, m.cant_prog, m.entrada, m.ultimo,
         o.n_op, o.operacion, coalesce(pp.producida, 0)
    from mods m
    join ops o on o.o_f = m.o_f and o.modulo = m.modulo
    left join prodop pp on pp.o_f = o.o_f and pp.modulo = o.modulo and pp.nop = o.n_op;
end $function$;

revoke execute on function public._avance_of_base(text, text, text) from public, anon, authenticated;

create or replace function public.fn_avance_of(p_dni text, p_token uuid, p_area text)
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '30s'
as $function$
declare s operarios; v json;
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  if s.cargo = 'SUPERVISORA' and p_area <> s.area_actual then raise exception 'NO_AUTORIZADA'; end if;

  with b as materialized (select * from _avance_of_base(p_area, null, null)),
  fin as (
    select distinct on (b.o_f, b.modulo) b.o_f, b.modulo, b.articulo, b.cant_prog,
           b.entrada, b.ultimo, b.n_op ref_nop, b.producida,
           count(*) over (partition by b.o_f, b.modulo) n_ops
      from b order by b.o_f, b.modulo, b.n_op desc
  ),
  llego as (
    -- Momento en que la última operación completó lo programado.
    select a.o_f, a.modulo, min(a.creado) salida
      from (select fn.o_f, fn.modulo, fn.cant_prog, r.creado,
                   sum(r.cant) over (partition by fn.o_f, fn.modulo order by r.creado, r.id
                                     rows between unbounded preceding and current row) cum
              from fin fn
              join reclamos r on r.o_f = fn.o_f and r.area = p_area and r.estado = 'ACTIVO'
                             and r.nop = fn.ref_nop
                             and coalesce(nullif(trim(r.modulo),''),'(sin módulo)') = fn.modulo
             where fn.cant_prog > 0 and fn.producida >= fn.cant_prog) a
     where a.cum >= a.cant_prog
     group by 1,2
  ),
  fila as (
    select fn.*,
           coalesce(l.salida,
             case when exists (select 1 from modulos_cerrados mc
                                where mc.area = p_area and _nk(mc.o_f) = _nk(fn.o_f)
                                  and _nk(mc.modulo) = _nk(fn.modulo))
                  then fn.ultimo end) salida
      from fin fn left join llego l on l.o_f = fn.o_f and l.modulo = fn.modulo
  )
  select coalesce(json_agg(json_build_object(
           'of', o_f, 'articulo', articulo, 'cant_prog', round(cant_prog,0),
           'pct', round(pct,1), 'n_mods', n_mods, 'n_listos', n_listos, 'mods', mods)
           order by ult desc, o_f), '[]'::json)
    into v
    from (
      select o_f, max(articulo) articulo, max(cant_prog) cant_prog, max(ultimo) ult,
             count(*) n_mods, count(salida) n_listos,
             -- Cada módulo aporta como mucho 100: lo producido de más en uno
             -- no tapa lo que falta en otro.
             avg(case when cant_prog > 0 then least(100, 100 * producida / cant_prog)
                      else 0 end) pct,
             json_agg(json_build_object(
               'modulo', modulo,
               'pct', case when cant_prog > 0 then round(100 * producida / cant_prog, 1)
                           else 0 end,
               'producida', round(producida,0),
               'listo', salida is not null,
               'n_ops', n_ops,
               'entrada', to_char(entrada at time zone 'America/Lima','DD-MM HH24:MI'),
               'salida',  to_char(salida  at time zone 'America/Lima','DD-MM HH24:MI'))
               order by ref_nop nulls last, modulo) mods
        from fila group by o_f
    ) x
   where n_listos < n_mods;

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Operaciones de un módulo, recién cuando la supervisora lo abre.
create or replace function public.fn_avance_of_ops(
  p_dni text, p_token uuid, p_area text, p_of text, p_modulo text)
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '15s'
as $function$
declare s operarios; v json;
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  if s.cargo = 'SUPERVISORA' and p_area <> s.area_actual then raise exception 'NO_AUTORIZADA'; end if;

  select coalesce(json_agg(json_build_object('n', n_op, 'op', operacion, 'p', round(producida,0))
                           order by n_op), '[]'::json)
    into v
    from _avance_of_base(p_area, p_of, p_modulo);

  return json_build_object('ok', true, 'ops', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- BASES: artículos del área con su STD total (minutos por prenda). Con
-- p_buscar solo los artículos con alguna operación que lo contenga; el filtro
-- por artículo, cliente y prenda lo hace el celular sobre esta misma lista.
create or replace function public.fn_bases_area_articulos(
  p_dni text, p_token uuid, p_area text, p_buscar text default '')
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '15s'
as $function$
declare s operarios; v json;
  q text := replace(replace(replace(trim(coalesce(p_buscar,'')),'\','\\'),'%','\%'),'_','\_');
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  if s.cargo = 'SUPERVISORA' and p_area <> s.area_actual then raise exception 'NO_AUTORIZADA'; end if;

  if q <> '' then
    select coalesce(json_agg(distinct articulo), '[]'::json) into v
      from bases
     where area = p_area and operacion ilike '%' || q || '%';
    return json_build_object('ok', true, 'articulos', v);
  end if;

  select coalesce(json_agg(json_build_object(
           'articulo', articulo, 'prenda', prenda, 'cliente', cliente,
           'n_ops', n_ops, 'n_mods', n_mods, 'std', round(std, 2))
           order by articulo), '[]'::json)
    into v
    from (select articulo, max(prenda) prenda, max(cliente) cliente,
                 count(*) n_ops, count(distinct modulo) n_mods, sum(std) std
            from bases where area = p_area
           group by articulo) a;

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Operaciones de un artículo, recién cuando la supervisora lo abre.
create or replace function public.fn_bases_area_ops(
  p_dni text, p_token uuid, p_area text, p_articulo text)
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '15s'
as $function$
declare s operarios; v json;
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  if s.cargo = 'SUPERVISORA' and p_area <> s.area_actual then raise exception 'NO_AUTORIZADA'; end if;

  select coalesce(json_agg(json_build_object(
           'modulo', modulo, 'n', n_op, 'op', operacion, 'std', std)
           order by n_op, id), '[]'::json)
    into v
    from bases where area = p_area and articulo = p_articulo;

  return json_build_object('ok', true, 'ops', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
