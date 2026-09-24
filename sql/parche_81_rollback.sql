-- PARCHE 81 — VUELTA ATRÁS
--
-- Reconstruye tal cual lo que da de baja el parche 81. Las definiciones se
-- sacaron de producción con pg_get_functiondef el 22-set-2026, antes de borrar.
-- Si algo se rompe después de aplicar el 81, esto lo deja como estaba.
--
-- No hace falta para los índices de A4 (reindex no borra nada) ni para A1
-- (el permiso se devuelve con el grant del final).

-- ===========================================================================
-- B1 · fn_tickets_area
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_tickets_area(p_dni text, p_token uuid, p_area text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return coalesce((select json_agg(json_build_object(
      'codigo', t.codigo, 'of', t.o_f, 'articulo', t.articulo, 'modulo', t.modulo,
      'op', t.op, 'nop', t.n_op, 'op_id', t.op_id, 'std', t.std, 'cant', t.cant,
      'talla', t.talla, 'color', t.color, 'corte', t.paq::text,
      'num', t.desde::text || '-' || t.hasta::text)
      order by t.o_f, t.n_op, t.paq)
    from tickets_cache t where t.area = p_area), '[]'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ===========================================================================
-- B2 · fn_asistencia_dia
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_asistencia_dia(p_dni text, p_token uuid, p_fecha date)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  perform _ing(p_dni, p_token);
  return json_build_object('ok', true,
    'estados', (select json_agg(nombre order by nombre) from estados_asistencia),
    'personal', coalesce((select json_agg(json_build_object(
       'dni', o.dni, 'nombre', o.nombres_apellidos, 'area', o.area_actual,
       'estado', _estado_dia(o.dni, p_fecha))
       order by o.area_actual, o.nombres_apellidos)
       from operarios o where o.cargo='OPERARIO' and o.estado='ACTIVO'), '[]'::json));
end $function$;

-- ===========================================================================
-- B3 · fn_asistencia_mes
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_asistencia_mes(p_dni text, p_token text, p_area text, p_anio integer, p_mes integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_desde date := make_date(p_anio, p_mes, 1);
  v_hasta date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  v_dias json; v_personal json;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  select json_agg(to_char(d, 'YYYY-MM-DD') order by d) into v_dias
    from generate_series(v_desde, v_hasta, interval '1 day') as d;
  select json_agg(
    json_build_object(
      'dni', o.dni, 'nombres_apellidos', o.nombres_apellidos,
      'estado_actual', o.estado, 'area_actual', o.area_actual,
      'registros', (
        select coalesce(json_object_agg(to_char(a.fecha,'YYYY-MM-DD'), a.estado), '{}'::json)
        from asistencia a
        where a.dni = o.dni and a.fecha between v_desde and v_hasta
      )
    ) order by o.nombres_apellidos
  ) into v_personal
  from operarios o
  where (p_area = '' or o.area_actual = p_area)
    and o.estado = 'ACTIVO'
    and o.cargo not in ('INGENIERIA','ESTAJERO');
  return json_build_object('ok', true, 'dias', coalesce(v_dias,'[]'::json),
                            'personal', coalesce(v_personal, '[]'::json));
exception
  when others then
    if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
    return json_build_object('ok', false, 'error', SQLERRM);
end;
$function$;

-- ===========================================================================
-- B4 · fn_marcar_asistencia
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_marcar_asistencia(p_dni text, p_token uuid, p_dnis text[], p_estado text, p_fecha date)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare s operarios; d text; n int := 0; v_fecha date;
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('INGENIERIA','SUPERVISORA') then raise exception 'NO_AUTORIZADA'; end if;
  if not exists (select 1 from estados_asistencia where nombre = p_estado) then
    return json_build_object('ok', false, 'error', 'Estado no existe: '||p_estado);
  end if;
  v_fecha := coalesce(p_fecha, _hoy());   -- si no se envía fecha, es hoy (Lima)
  foreach d in array p_dnis loop
    -- La supervisora solo puede marcar a personal de SU área actual.
    if s.cargo = 'SUPERVISORA'
       and not exists (select 1 from operarios where dni = d and area_actual = s.area_actual) then
      continue;
    end if;
    insert into asistencia (dni, fecha, estado, registrado_por)
    values (d, v_fecha, p_estado, s.dni)
    on conflict (dni, fecha)
    do update set estado = excluded.estado, registrado_por = excluded.registrado_por, creado = now();
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'afectados', n);
exception
  when others then
    if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
    return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ===========================================================================
-- B5 · fn_liberar_registro
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_liberar_registro(p_dni text, p_token uuid, p_id bigint, p_motivo text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare s operarios; n integer;
begin
  s := _auth(p_dni, p_token);
  update reclamos
     set estado = 'LIBERADO',
         motivo_liberacion = coalesce(nullif(trim(p_motivo),''),'Liberado')
   where id = p_id and estado = 'ACTIVO' and codigo is null
     and (s.cargo = 'INGENIERIA' or (dni = s.dni and fecha >= (_hoy() - 1)));
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok',false,'error','No se pudo liberar ese registro'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ===========================================================================
-- B6 · fn_min_incidencia
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_min_incidencia(p_tipo text, p_horas integer, p_salida time without time zone, p_retorno time without time zone, p_confirmado boolean, p_minutos numeric)
 RETURNS numeric LANGUAGE sql IMMUTABLE
AS $function$
  select case
    when p_tipo = 'TARDANZA'            then -60::numeric
    when p_tipo = 'HORA_EXTRA'          then (coalesce(p_horas,1) * 60)::numeric
    /* Horas pagadas en las que no pudo producir: salen de su disponible, así
       su eficiencia no se castiga. Mismo signo que la máquina parada. */
    when p_tipo = 'PAGO_HORA'           then -(coalesce(p_horas,1) * 60)::numeric
    when p_tipo in ('SEGURO','PERMISO') then - _min_salida(p_salida, p_retorno, p_confirmado)
    else coalesce(p_minutos,0) end;
$function$;

-- ===========================================================================
-- C · fn_asignar_tickets
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_asignar_tickets(p_dni text, p_token uuid, p_area text, p_dni_op text, p_codigos text[])
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '30s'
AS $function$
declare s operarios; t record; n int := 0;
        v_omit text[] := '{}'; v_est text;
begin
  s := _ing(p_dni, p_token);
  if not exists (select 1 from operarios
                  where dni = p_dni_op and cargo in ('OPERARIO','ESTAJERO') and estado = 'ACTIVO') then
    return json_build_object('ok', false, 'error', 'Esa persona no está activa');
  end if;
  if p_codigos is null or array_length(p_codigos,1) is null then
    return json_build_object('ok', false, 'error', 'No hay tickets seleccionados');
  end if;
  v_est := _ausente_en(p_dni_op, _hoy());
  if v_est is not null then
    return json_build_object('ok', false, 'error',
      'Hoy esa persona está como '||v_est||': no se le pueden asignar tickets.');
  end if;

  perform set_config('samitex.asignando', 'on', true);

  for t in
    select * from tickets_cache x
    where x.area = p_area and x.codigo = any(p_codigos)
  loop
    if _modulo_cerrado(p_area, t.o_f, t.modulo) then
      v_omit := v_omit || (t.codigo||' (módulo cerrado)');
      continue;
    end if;
    begin
      insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant,
                            cant_asignada, numeracion, articulo, talla, color, corte, nop)
      values (t.codigo, p_dni_op, p_area, t.o_f, t.modulo, t.op, t.std, t.cant,
              t.cant, t.desde::text||'-'||t.hasta::text, t.articulo,
              t.talla, t.color, t.paq::text, t.n_op);
      n := n + 1;
    exception when unique_violation then
      v_omit := v_omit || (t.codigo||' (ya estaba tomado)');
    end;
  end loop;

  if n = 0 then
    return json_build_object('ok', false, 'omitidos', to_json(v_omit),
      'error', 'No se pudo asignar ninguno de los tickets seleccionados.');
  end if;
  return json_build_object('ok', true, 'asignados', n,
    'omitidos', to_json(v_omit), 'omitidos_n', coalesce(array_length(v_omit,1),0));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ===========================================================================
-- Permisos: las siete los tenían antes del parche 81.
-- ===========================================================================
grant execute on function public.fn_tickets_area(text, uuid, text) to anon, authenticated;
grant execute on function public.fn_asistencia_dia(text, uuid, date) to anon, authenticated;
grant execute on function public.fn_asistencia_mes(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.fn_marcar_asistencia(text, uuid, text[], text, date) to anon, authenticated;
grant execute on function public.fn_liberar_registro(text, uuid, bigint, text) to anon, authenticated;
grant execute on function public.fn_min_incidencia(text, integer, time without time zone, time without time zone, boolean, numeric) to anon, authenticated;
grant execute on function public.fn_asignar_tickets(text, uuid, text, text, text[]) to anon, authenticated;

-- A1 · Si también quieres reabrir los tres internos (NO recomendado):
-- grant execute on function public.fn_tickets_cache_refrescar(text, text) to anon, authenticated;
-- grant execute on function public.fn_tickets_cache_refrescar_articulo(text, text) to anon, authenticated;
-- grant execute on function public.fn_tickets_of_raw(text, text) to anon, authenticated;

-- A2 y A3 · Los índices, si hicieran falta:
-- create index concurrently if not exists reclamos_motivo_fecha_idx
--   on public.reclamos using btree (motivo_fecha) where (motivo_fecha is not null);
-- create index concurrently if not exists tickets_cache_area_idx
--   on public.tickets_cache using btree (area);
