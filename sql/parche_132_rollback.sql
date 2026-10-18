-- ROLLBACK parche 132: vuelve fn_traza_of a la versión del parche 106 (sin 'ops' en acabado)
begin;

-- Ficha de OF: avance por área y módulo, paquetes con hueco y liberados.
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
           exists (select 1 from reclamos r where r.area = t.area and r.codigo = t.codigo and r.estado = 'ACTIVO') reg
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
          select tk.modulo, min(tk.n_op) min_op, count(*) tickets, count(*) filter (where tk.reg) registrados
            from tk where tk.area = a.area group by tk.modulo) m),
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
             'und', sum(r.cant), 'desde', to_char(min(r.fecha),'YYYY-MM-DD'), 'hasta', to_char(max(r.fecha),'YYYY-MM-DD'))
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

commit;
