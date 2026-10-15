-- PARCHE 127 — Quita las bases por lote del 123 (ya reemplazadas por BASES del 126)
-- REPROCESO ahora usa bases normales y OF provisional. Se borran lote_bases,
-- lote_base_ops y lotes.base_op_id, y se dejan _lote_std, _lote_json y
-- fn_lote_tiempos como eran antes del 123 (tiempo por tarea).
-- Rollback: parche_127_rollback.sql
begin;

create or replace function public._lote_std(l lotes)
 returns numeric language sql stable security definer set search_path to 'public' as $$
  select k.std from lote_tareas k where k.area = l.area and k.nombre = l.tarea
$$;
revoke all on function public._lote_std(lotes) from public, anon, authenticated;

create or replace function public._lote_json(l lotes)
 returns json language sql stable security definer set search_path to 'public' as $$
  select json_build_object('id', l.id, 'area', l.area, 'destino', l.destino, 'tarea', l.tarea, 'cantidad', l.cantidad,
    'o_f', l.o_f, 'estado', l.estado, 'creado', l.creado, 'cerrado', l.cerrado,
    'hecho', coalesce(sum(t.prendas), 0),
    'queda', greatest(l.cantidad - coalesce(sum(t.prendas), 0), 0),
    'min', coalesce(sum(_tramo_min(t.inicio, coalesce(t.fin, now()))), 0),
    'min_hoy', coalesce(sum(_tramo_min(greatest(t.inicio, (_hoy()::timestamp at time zone 'America/Lima')), coalesce(t.fin, now())))
                         filter (where coalesce(t.fin, now()) >= (_hoy()::timestamp at time zone 'America/Lima')), 0),
    'min_contado', coalesce(sum(_tramo_min(t.inicio, t.fin)) filter (where t.prendas is not null), 0),
    'ahora', count(*) filter (where t.fin is null),
    'personas', count(distinct t.dni),
    'por_revisar', count(*) filter (where t.fin is not null and t.prendas is null and t.revisado is null),
    'std', _lote_std(l),
    'minutaje', (select coalesce(sum(r.minutos), 0) from reclamos r join lote_tramos x on x.id = r.lote_tramo_id
                  where x.lote_id = l.id and r.estado = 'ACTIVO'))
  from lote_tramos t where t.lote_id = l.id
$$;
revoke all on function public._lote_json(lotes) from public, anon, authenticated;

create or replace function public.fn_lote_tiempos(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_areas text[];
begin
  o := _auth(p_dni, p_token);
  select array_agg(a) into v_areas from unnest(array['DESPACHO','REPROCESO','CORTE']) a where _lote_permiso(o, a, false);
  if v_areas is null then raise exception 'NO_AUTORIZADA: sin acceso a Trabajo por tiempo'; end if;
  return json_build_object('ok', true,
    'areas', (select json_agg(json_build_object('area', a, 'edita', _lote_tiempo_permiso(o, a)) order by a) from unnest(v_areas) a),
    'tareas', coalesce((select json_agg(json_build_object('id', k.id, 'area', k.area, 'nombre', k.nombre, 'std', k.std, 'activo', k.activo,
        'actualizado', k.actualizado, 'por', coalesce(op.nombres_apellidos, k.actualizado_por),
        'prendas', z.prendas, 'min', z.min, 'personas', z.personas, 'tramos', z.tramos,
        'real', case when z.prendas > 0 then round(z.min / z.prendas, 3) end,
        'sin_minutaje', z.sin_mj) order by k.area, k.activo desc, k.id)
      from lote_tareas k
      left join operarios op on op.dni = k.actualizado_por
      left join lateral (
        select coalesce(sum(t.prendas), 0) prendas, coalesce(sum(_tramo_min(t.inicio, t.fin)), 0) min,
               count(distinct t.dni) personas, count(*) tramos,
               count(*) filter (where not exists (select 1 from reclamos r where r.lote_tramo_id = t.id)) sin_mj
          from lote_tramos t join lotes l on l.id = t.lote_id
         where l.area = k.area and l.tarea = k.nombre and t.prendas > 0 and t.fin is not null
           and t.inicio > now() - interval '30 days') z on true
      where k.area = any(v_areas)), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_lote_tiempos(text, uuid) to anon, authenticated;

alter table public.lotes drop column if exists base_op_id;
drop table if exists public.lote_base_ops;
drop table if exists public.lote_bases;

commit;
