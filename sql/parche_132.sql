-- PARCHE 132 — Buscar y Seguir: ACABADO por cantidades; OF COMPLETADA (cerrar todos los módulos)
-- fn_traza_of: misma firma y misma salida; 'acabado' suma cant_prog y ops[{n_op,modulo,operacion,marcadas,personas,ultimo}].
-- fn_of_completar (nueva): marca una OF como COMPLETADA en un área (cierra todos sus módulos, así sus
--   tickets dejan de contar como pendientes y nadie más los reclama) o la reabre. Solo INGENIERIA.
--   Al dar "No vigente" en Carga vs capacidad se usa esta función; 'completada' en fn_traza_of
--   deja ver el estado y reabrir desde Buscar y Seguir.
-- Rollback: parche_132_rollback.sql
begin;

create or replace function public.fn_of_completar(p_dni text, p_token uuid, p_area text, p_of text, p_completar boolean)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s operarios; v_n int;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  if coalesce(trim(p_area),'') = '' or coalesce(trim(p_of),'') = '' then
    return json_build_object('ok', false, 'error', 'Área y OF son obligatorias');
  end if;
  if p_completar then
    insert into modulos_cerrados(area, o_f, modulo, cerrado_por)
    select distinct t.area, t.o_f, upper(trim(t.modulo)), s.dni
      from tickets_cache t
     where t.area = p_area and t.o_f = upper(trim(p_of)) and coalesce(trim(t.modulo),'') <> ''
    on conflict (area, o_f, modulo) do nothing;
    get diagnostics v_n = row_count;
  else
    delete from modulos_cerrados where area = p_area and upper(trim(o_f)) = upper(trim(p_of));
    get diagnostics v_n = row_count;
  end if;
  return json_build_object('ok', true, 'completada', p_completar, 'modulos', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;


-- Ficha de OF (parche 132): ACABADO suma 'cant_prog' y 'ops' (cantidad marcada por operación).
create or replace function public.fn_traza_of(p_dni text, p_token uuid, p_of text)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '15s'
as $function$
declare o operarios; v_areas text[]; v_of json; v_j json; v_acab json;
begin
  o := _auth(p_dni, p_token);
  v_areas := _buscar_areas(o);
  select json_build_object('of', f.o_f, 'articulo', f.articulo, 'prenda', f.prenda, 'cant_prog', f.cant_prog,
           'cargado_por', f.cargado_por, 'fecha_carga', to_char(f.fecha_carga at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
           'paquetes', (select count(*) from of_detalle d where d.o_f = f.o_f))
    into v_of from ofs f where f.o_f = p_of;

  with tk as (
    select t.area, t.modulo, t.n_op, t.op, t.codigo, t.desde, t.hasta,
           exists (select 1 from reclamos r where r.area = t.area and r.codigo = t.codigo and r.estado = 'ACTIVO') reg,
           exists (select 1 from modulos_cerrados c where c.area = t.area and c.o_f = t.o_f and upper(trim(c.modulo)) = upper(trim(t.modulo))) cer
      from tickets_cache t
     where t.o_f = p_of and (v_areas is null or t.area = any(v_areas))
  ), rc as (
    select r.area, r.estado, r.dni, r.fecha, r.creado, r.motivo_fecha, r.motivo_liberacion
      from reclamos r where r.o_f = p_of and (v_areas is null or r.area = any(v_areas)) and r.area <> 'ACABADO'
  )
  select json_agg(json_build_object(
      'area', a.area,
      'tickets', (select count(*) from tk where tk.area = a.area),
      'registrados', (select count(*) from tk where tk.area = a.area and tk.reg),
      'personas', (select count(distinct dni) from rc where rc.area = a.area and rc.estado = 'ACTIVO'),
      'primero', (select to_char(min(fecha),'YYYY-MM-DD') from rc where rc.area = a.area and rc.estado = 'ACTIVO'),
      'ultimo', (select to_char(max(fecha),'YYYY-MM-DD') from rc where rc.area = a.area and rc.estado = 'ACTIVO'),
      'otro_dia', (select count(*) from rc where rc.area = a.area and rc.estado = 'ACTIVO' and rc.motivo_fecha is not null),
      'modulos', (select json_agg(m order by m.min_op) from (
          select tk.modulo, min(tk.n_op) min_op, count(*) tickets, count(*) filter (where tk.reg) registrados,
                 bool_and(tk.cer) cerrado
            from tk where tk.area = a.area group by tk.modulo) m),
      'completada', (select bool_and(tk.cer) from tk where tk.area = a.area),
      'huecos', (select json_agg(h order by h.desde) from (
          select tk.desde, tk.hasta, count(*) filter (where not tk.reg) faltan, count(*) ops
            from tk where tk.area = a.area group by tk.desde, tk.hasta
           having count(*) filter (where tk.reg) > 0 and count(*) filter (where not tk.reg) > 0
           order by count(*) filter (where not tk.reg) desc, tk.desde limit 30) h),
      'liberados', (select json_agg(l order by l.n desc) from (
          select coalesce(nullif(trim(rc.motivo_liberacion),''),'(sin motivo)') motivo, count(*) n
            from rc where rc.area = a.area and rc.estado = 'LIBERADO' group by 1 order by 2 desc limit 12) l))
      order by a.area) into v_j
    from (select distinct area from tk) a;

  if v_areas is null or 'ACABADO' = any(v_areas) then
    select json_build_object('registros', count(*), 'personas', count(distinct r.dni),
             'und', sum(r.cant), 'desde', to_char(min(r.fecha),'YYYY-MM-DD'), 'hasta', to_char(max(r.fecha),'YYYY-MM-DD'),
             'cant_prog', (select round(f.cant_prog,0) from ofs f where f.o_f = p_of),
             'ops', (select json_agg(x order by x.n_op) from (
                 select ru.n_op, ru.modulo, ru.operacion,
                        round(coalesce(sum(g.cant),0),0) marcadas,
                        count(distinct g.dni) personas,
                        to_char(max(g.fecha),'YYYY-MM-DD') ultimo
                   from (select distinct on (b.n_op) b.n_op, b.modulo, b.operacion
                           from bases b join ofs f on f.o_f = p_of
                          where b.area = 'ACABADO' and coalesce(b.n_op,0) > 0 and _nk(b.articulo) = _nk(f.articulo)
                          order by b.n_op, b.id) ru
                   left join reclamos g on g.o_f = p_of and g.area = 'ACABADO' and g.estado = 'ACTIVO' and g.nop = ru.n_op
                  group by ru.n_op, ru.modulo, ru.operacion) x))
      into v_acab from reclamos r where r.o_f = p_of and r.area = 'ACABADO' and r.estado = 'ACTIVO';
  end if;

  if v_of is null and v_j is null then
    return json_build_object('ok', false, 'error', 'No encontré la OF ' || p_of || ' (o no tienes acceso a su área)');
  end if;
  return json_build_object('ok', true, 'of', v_of, 'areas', coalesce(v_j, '[]'::json), 'acabado', v_acab);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_traza_of(text, uuid, text) to anon, authenticated;
grant execute on function public.fn_of_completar(text, uuid, text, text, boolean) to anon, authenticated;

commit;
