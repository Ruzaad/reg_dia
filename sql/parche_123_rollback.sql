-- ROLLBACK PARCHE 123 — vuelve a como dejó el parche 119.
-- Los lotes creados con base se quedan (con su tarea y cantidad) pero vuelven
-- a tomar el tiempo por tarea. El minutaje ya generado no se toca.
begin;
create or replace function public._lote_minutaje(p_tramo bigint)
 returns numeric language plpgsql security definer set search_path to 'public' as $function$
declare t lote_tramos; l lotes; v_std numeric; v_cargo text; v_rid bigint; v_perm text; v_min numeric;
begin
  select * into t from lote_tramos where id = p_tramo;
  if t.id is null then return null; end if;
  select * into l from lotes where id = t.lote_id;
  select std into v_std from lote_tareas where area = l.area and nombre = l.tarea;
  select cargo into v_cargo from operarios where dni = t.dni;
  select id into v_rid from reclamos where lote_tramo_id = t.id;
  v_perm := current_setting('app.perm', true);
  perform set_config('app.perm', '*', true);
  if t.fin is null or coalesce(t.prendas, 0) = 0 then
    if v_rid is not null then delete from reclamos where id = v_rid; end if;
  elsif v_rid is not null then
    update reclamos set cant = t.prendas, fecha = (t.inicio at time zone 'America/Lima')::date where id = v_rid;
  elsif v_std is not null and v_cargo in ('OPERARIO','ESTAJERO') then
    insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant, fecha, lote_tramo_id)
    values (null, t.dni, l.area, l.o_f, 'L-' || l.id, l.tarea, v_std, t.prendas,
            (t.inicio at time zone 'America/Lima')::date, t.id);
  end if;
  perform set_config('app.perm', coalesce(v_perm, ''), true);
  select minutos into v_min from reclamos where lote_tramo_id = t.id and estado = 'ACTIVO';
  return v_min;
end $function$;
revoke all on function public._lote_minutaje(bigint) from public, anon, authenticated;

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
    'std', (select k.std from lote_tareas k where k.area = l.area and k.nombre = l.tarea),
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

drop function if exists public.fn_lote_crear_base(text, uuid, integer, text, integer, text);
drop function if exists public.fn_lote_base_guardar(text, uuid, integer, text, text, json, boolean, date);
drop function if exists public.fn_lote_bases(text, uuid);
drop function if exists public._lote_std(lotes);
alter table public.lotes drop column if exists base_op_id;
drop table if exists public.lote_base_ops;
drop table if exists public.lote_bases;

commit;
