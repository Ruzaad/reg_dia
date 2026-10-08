-- PARCHE 106 — Buscar y seguir una OF, una prenda o una persona
-- Solo lectura. Un buscador que cruza OF, artículo, N° de prenda (hoja de
-- numeración), OF/prenda, nombre o DNI, y tres fichas: paquete (sigue la
-- NUMERACIÓN por todas las operaciones, porque el número de paquete cambia
-- con el troceo), OF y persona. Respeta las áreas de Gestión › Permisos; la
-- supervisora solo ve su área. Quién liberó o movió sale del Historial de
-- cambios (parche 102), así que antes del 7-oct no hay ese dato.
-- No crea tablas ni cambia funciones existentes. Agrega 5 índices.
begin;

create index if not exists reclamos_area_codigo_idx on public.reclamos (area, codigo);
create index if not exists reclamos_of_idx on public.reclamos (o_f);
create index if not exists reclamos_dni_fecha_idx on public.reclamos (dni, fecha);
create index if not exists tickets_cache_of_idx on public.tickets_cache (o_f);
create index if not exists tickets_cambios_det_fila_idx on public.tickets_cambios_det (fila) where tabla = 'reclamos';

-- Áreas que puede ver quien busca. NULL = todas.
create or replace function public._buscar_areas(o operarios)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v text[];
begin
  if o.cargo = 'SUPERVISORA' then return array[o.area_actual]; end if;
  if o.cargo in ('OPERARIO','ESTAJERO') then raise exception 'NO_AUTORIZADA'; end if;
  if coalesce(o.es_admin, false)
     or exists (select 1 from permisos_area where dni = o.dni and area = '*') then
    return null;
  end if;
  select array_agg(area) into v from permisos_area where dni = o.dni and area <> '*';
  return coalesce(v, '{}');
end $function$;

-- Buscador: agrupa prendas (hoja de numeración), OF y personas.
create or replace function public.fn_buscar(p_dni text, p_token uuid, p_q text)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '10s'
as $function$
declare o operarios; v_areas text[]; q text := upper(trim(coalesce(p_q,''))); v_of text; v_n int;
        v_prendas json; v_ofs json; v_per json;
begin
  o := _auth(p_dni, p_token);
  v_areas := _buscar_areas(o);
  if length(q) < 3 and q !~ '^\d+/\d+$' then
    return json_build_object('ok', true, 'prendas', '[]'::json, 'ofs', '[]'::json, 'personas', '[]'::json);
  end if;
  if q ~ '^\d+\s*/\s*\d+$' then
    v_of := trim(split_part(q, '/', 1)); v_n := trim(split_part(q, '/', 2))::int;
  elsif q ~ '^\d{1,6}$' then
    v_n := q::int;
  end if;

  -- Prendas: la hoja de numeración que contiene ese N° (en la OF dada, si la hay).
  if v_n is not null then
    select coalesce(json_agg(x order by x.of desc), '[]'::json) into v_prendas from (
      select d.o_f "of", f.articulo, d.prenda, d.paq, d.desde, d.hasta, d.talla, d.color, d.cant,
             a.area,
             (select count(*) from tickets_cache t where t.area = a.area and t.o_f = d.o_f
                 and v_n between t.desde and t.hasta) ops_tot,
             (select count(*) from tickets_cache t where t.area = a.area and t.o_f = d.o_f
                 and v_n between t.desde and t.hasta
                 and exists (select 1 from reclamos r where r.area = t.area and r.codigo = t.codigo and r.estado = 'ACTIVO')) ops_reg
        from of_detalle d
        left join ofs f on f.o_f = d.o_f
        cross join lateral (select t.area from tickets_cache t where t.o_f = d.o_f
                             and (v_areas is null or t.area = any(v_areas)) group by t.area) a
       where v_n between d.desde and d.hasta and (v_of is null or d.o_f = v_of)
       limit 8) x;
  end if;

  -- OF: por número (empieza con) o por artículo.
  select coalesce(json_agg(x order by x.of desc), '[]'::json) into v_ofs from (
    select f.o_f "of", f.articulo, f.prenda, f.cant_prog,
           (select array_agg(distinct t.area) from tickets_cache t where t.o_f = f.o_f
              and (v_areas is null or t.area = any(v_areas))) areas
      from ofs f
     where v_of is null
       and (f.o_f like q || '%' or upper(f.articulo) like q || '%')
       and exists (select 1 from tickets_cache t where t.o_f = f.o_f and (v_areas is null or t.area = any(v_areas)))
     order by f.o_f desc limit 8) x;

  -- Personas: DNI o nombre.
  if v_of is null then
    select coalesce(json_agg(x), '[]'::json) into v_per from (
      select op.dni, op.nombres_apellidos nombre, op.area_origen area, op.cargo, op.estado
        from operarios op
       where op.cargo in ('OPERARIO','ESTAJERO')
         and (op.dni like q || '%' or (q !~ '^\d+$' and upper(op.nombres_apellidos) like '%' || q || '%'))
         and (v_areas is null or op.area_origen = any(v_areas) or op.area_actual = any(v_areas))
       order by op.estado, op.nombres_apellidos limit 8) x;
  end if;

  return json_build_object('ok', true, 'q', q, 'prendas', coalesce(v_prendas, '[]'::json),
    'ofs', coalesce(v_ofs, '[]'::json), 'personas', coalesce(v_per, '[]'::json),
    'rango_of', (select json_build_object('min', min(o_f::int), 'max', max(o_f::int)) from ofs where o_f ~ '^\d{1,9}$'));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Registros de un ticket (todos los estados) con quién liberó o movió.
create or replace function public._traza_regs(p_area text, p_codigo text)
 returns json
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(json_agg(json_build_object(
      'id', r.id, 'dni', r.dni, 'nombre', op.nombres_apellidos, 'estado', r.estado,
      'fecha', to_char(r.fecha,'YYYY-MM-DD'),
      'creado', to_char(r.creado at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'motivo_fecha', r.motivo_fecha, 'motivo_lib', r.motivo_liberacion, 'cant', r.cant,
      'lib', (select json_build_object('por', c.dni, 'cuando', to_char(c.creado at time zone 'America/Lima','YYYY-MM-DD HH24:MI'), 'motivo', c.motivo)
                from tickets_cambios_det d join tickets_cambios c on c.id = d.cambio_id
               where d.tabla = 'reclamos' and d.fila = r.id::text and d.despues->>'estado' = 'LIBERADO'
               order by c.creado desc limit 1),
      'movido', (select json_build_object('por', c.dni, 'cuando', to_char(c.creado at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
                         'de', d.antes->>'fecha', 'a', d.despues->>'fecha', 'motivo', c.motivo)
                from tickets_cambios_det d join tickets_cambios c on c.id = d.cambio_id
               where d.tabla = 'reclamos' and d.fila = r.id::text and c.accion = 'MOVER'
                 and d.antes->>'fecha' is distinct from d.despues->>'fecha'
               order by c.creado desc limit 1))
      order by r.creado), '[]'::json)
    from reclamos r left join operarios op on op.dni = r.dni
   where r.area = p_area and r.codigo = p_codigo
$function$;

-- Ficha de paquete: la prenda N de la OF por todas las operaciones de cada área.
create or replace function public.fn_traza_paquete(p_dni text, p_token uuid, p_of text, p_prenda int)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '15s'
as $function$
declare o operarios; v_areas text[]; v_hn json; v_of json; v_areas_j json; v_acab json;
begin
  o := _auth(p_dni, p_token);
  v_areas := _buscar_areas(o);
  select json_agg(json_build_object('paq', d.paq, 'desde', d.desde, 'hasta', d.hasta, 'talla', d.talla,
           'color', d.color, 'cant', d.cant, 'prenda', d.prenda)) into v_hn
    from of_detalle d where d.o_f = p_of and p_prenda between d.desde and d.hasta;
  select json_build_object('of', f.o_f, 'articulo', f.articulo, 'prenda', f.prenda, 'cant_prog', f.cant_prog,
           'cargado_por', f.cargado_por, 'fecha_carga', to_char(f.fecha_carga at time zone 'America/Lima','YYYY-MM-DD HH24:MI'))
    into v_of from ofs f where f.o_f = p_of;

  select json_agg(json_build_object('area', a.area, 'ops', (
      select json_agg(json_build_object('n_op', t.n_op, 'modulo', t.modulo, 'op', t.op, 'codigo', t.codigo,
               'paq', t.paq, 'desde', t.desde, 'hasta', t.hasta, 'cant', t.cant,
               'regs', _traza_regs(t.area, t.codigo)) order by t.n_op, t.desde)
        from tickets_cache t
       where t.area = a.area and t.o_f = p_of and p_prenda between t.desde and t.hasta)) order by a.area)
    into v_areas_j
    from (select distinct t.area from tickets_cache t where t.o_f = p_of
            and (v_areas is null or t.area = any(v_areas))) a;

  if v_areas is null or 'ACABADO' = any(v_areas) then
    select json_build_object('registros', count(*), 'personas', count(distinct r.dni),
             'und', sum(r.cant), 'desde', to_char(min(r.fecha),'YYYY-MM-DD'), 'hasta', to_char(max(r.fecha),'YYYY-MM-DD'))
      into v_acab from reclamos r where r.o_f = p_of and r.area = 'ACABADO' and r.estado = 'ACTIVO';
  end if;

  if (v_areas_j is null and v_hn is null) or (v_areas_j is null and v_areas is not null) then
    return json_build_object('ok', false, 'error', 'No encontré la prenda ' || p_prenda || ' en la OF ' || p_of || ' (o no tienes acceso a su área)');
  end if;
  return json_build_object('ok', true, 'of', v_of, 'prenda', p_prenda, 'hn', v_hn,
    'areas', coalesce(v_areas_j, '[]'::json), 'acabado', v_acab);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

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

-- Ficha de persona: sus últimos 10 días con tickets, minutos, registrados otro
-- día y quién los movió.
create or replace function public.fn_traza_persona(p_dni text, p_token uuid, p_persona text)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '10s'
as $function$
declare o operarios; v_areas text[]; p operarios; v json;
begin
  o := _auth(p_dni, p_token);
  v_areas := _buscar_areas(o);
  select * into p from operarios where dni = p_persona;
  if p.dni is null or not (v_areas is null or p.area_origen = any(v_areas) or p.area_actual = any(v_areas)) then
    return json_build_object('ok', false, 'error', 'No encontré a esa persona (o no tienes acceso a su área)');
  end if;
  select json_agg(x order by x.fecha desc) into v from (
    select to_char(r.fecha,'YYYY-MM-DD') fecha,
           count(*) filter (where r.estado = 'ACTIVO') tickets,
           round(sum(r.minutos) filter (where r.estado = 'ACTIVO'), 1) minutos,
           count(*) filter (where r.estado = 'LIBERADO') liberados,
           string_agg(distinct r.o_f, ', ') ofs,
           (select json_agg(json_build_object('motivo', y.motivo_fecha, 'n', y.n, 'creado', y.creado))
              from (select r2.motivo_fecha, count(*) n, to_char(max(r2.creado at time zone 'America/Lima'),'YYYY-MM-DD HH24:MI') creado
                      from reclamos r2 where r2.dni = p.dni and r2.fecha = r.fecha and r2.estado = 'ACTIVO'
                       and r2.motivo_fecha is not null group by 1) y) otro_dia
      from reclamos r
     where r.dni = p.dni and r.fecha > _hoy() - 21
     group by r.fecha order by r.fecha desc limit 10) x;
  return json_build_object('ok', true, 'persona', json_build_object('dni', p.dni, 'nombre', p.nombres_apellidos,
      'area', p.area_origen, 'area_actual', p.area_actual, 'cargo', p.cargo, 'estado', p.estado),
    'dias', coalesce(v, '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke execute on function public._buscar_areas(operarios) from public, anon, authenticated;
revoke execute on function public._traza_regs(text, text) from public, anon, authenticated;
grant execute on function public.fn_buscar(text, uuid, text) to anon, authenticated;
grant execute on function public.fn_traza_paquete(text, uuid, text, int) to anon, authenticated;
grant execute on function public.fn_traza_of(text, uuid, text) to anon, authenticated;
grant execute on function public.fn_traza_persona(text, uuid, text) to anon, authenticated;

commit;
