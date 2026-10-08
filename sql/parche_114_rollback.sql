-- Rollback del parche 114: vuelve las funciones a como estaban y quita las nuevas.
-- Deja las columnas nuevas (no estorban y guardan lo que ya se pidió).
begin;
drop trigger if exists ocurrencias_pedido on ocurrencias;
drop function if exists public._ocurrencia_pedido();
drop function if exists public.fn_solicitud_ajuste_crear(text,uuid,text,integer,text,text,text,text,text);
drop function if exists public.fn_solicitud_resolver(text,uuid,bigint,boolean,integer,text);
drop function if exists public.fn_solicitud_visto_bueno(text,uuid,bigint,boolean,text);
drop function if exists public.fn_solicitudes_panel(text,uuid,text,integer);
drop function if exists public.fn_solicitudes_mias(text,uuid);
drop function if exists public.fn_reprocesos_apoyo(text,uuid,text,date,date);
CREATE OR REPLACE FUNCTION public.fn_solicitud_ajuste_crear(p_dni text, p_token uuid, p_area text, p_minutos integer, p_motivo text, p_tipo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare quien operarios; v_tipo text; v_motivo text; v_est text;
begin
  quien := _auth(p_dni, p_token);
  if p_minutos = 0 then return json_build_object('ok',false,'error','Los minutos no pueden ser 0'); end if;

  -- Parche 53: no se pide descuento de un día que no se trabajó.
  v_est := _ausente_en(p_dni, _hoy());
  if v_est is not null then
    return json_build_object('ok',false,'error',
      'Hoy tu asistencia está como '||v_est||': no se puede pedir descuento de tiempo. '
      ||'Avisa a supervisión si es un error.');
  end if;

  -- Tipo del catálogo del operario. Si llega algo fuera de lista se trata como
  -- texto libre: OTROS con el motivo tal cual lo escribió.
  v_tipo := upper(coalesce(nullif(trim(p_tipo),''), ''));
  if v_tipo not in ('MAQUINA','ARREGLOS','MUESTRAS','REPROCESOS','DESCOSER','OTROS') then
    v_tipo := _tipo_ajuste(p_motivo);
  end if;

  /* El detalle es libre para TODOS los tipos y NUNCA cambia el tipo elegido
     (parche 53). Si no escribe nada, el detalle repite el tipo; OTROS es el
     único que lo exige. */
  v_motivo := nullif(trim(p_motivo),'');
  if v_tipo = 'OTROS' and v_motivo is null then
    return json_build_object('ok',false,'error','Indica el motivo');
  end if;
  if v_motivo is null then v_motivo := v_tipo; end if;

  insert into solicitudes_ajuste(dni, area, minutos, motivo, tipo)
  values (p_dni, p_area, p_minutos, v_motivo, v_tipo);
  return json_build_object('ok',true,'tipo',v_tipo);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' then raise; end if;
  return json_build_object('ok',false,'error',SQLERRM);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_solicitud_resolver(p_dni text, p_token uuid, p_id bigint, p_aprobar boolean, p_minutos_final integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare quien operarios; sol solicitudes_ajuste; v_min int; v_tipo text; v_est text;
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;

  select * into sol from solicitudes_ajuste where id = p_id;
  if not found then return json_build_object('ok',false,'error','Solicitud no encontrada'); end if;
  if sol.estado <> 'PENDIENTE' then return json_build_object('ok',false,'error','Ya fue resuelta'); end if;

  -- Solicitudes creadas por una supervisora: solo INGENIERIA las aprueba/rechaza.
  if coalesce(sol.solo_ingenieria, false) and quien.cargo <> 'INGENIERIA' then
    raise exception 'NO_AUTORIZADA';
  end if;
  -- La supervisora solo resuelve solicitudes de su área.
  if quien.cargo = 'SUPERVISORA' and sol.area <> quien.area_actual then
    raise exception 'NO_AUTORIZADA';
  end if;

  if p_aprobar then
    /* Parche 53: el estado del día pudo cambiar entre el pedido y la
       aprobación (le marcaron DM al día siguiente). Rechazar es más seguro
       que aplicar minutos a un día no trabajado. */
    v_est := _ausente_en(sol.dni, sol.fecha);
    if v_est is not null then
      return json_build_object('ok',false,'error',
        'El '||to_char(sol.fecha,'YYYY-MM-DD')||' esa persona está como '||v_est
        ||': no se puede aprobar. Corrige la asistencia o rechaza la solicitud.');
    end if;
    v_min := coalesce(p_minutos_final, sol.minutos);
    if v_min = 0 then return json_build_object('ok',false,'error','Minutos no pueden ser 0'); end if;
    -- Solicitudes anteriores al parche 52 no tienen tipo: se deduce del motivo.
    v_tipo := coalesce(nullif(trim(sol.tipo),''), _tipo_ajuste(sol.motivo));
    insert into ocurrencias (dni, area, tipo, minutos, detalle, supervisora_dni, fecha)
    values (sol.dni, sol.area, v_tipo, v_min,
            coalesce(nullif(trim(sol.motivo),''), v_tipo), p_dni, sol.fecha);
    update solicitudes_ajuste
      set estado='APROBADO', minutos_final=v_min, resuelto_por=p_dni, resuelto_en=now()
     where id = p_id;
  else
    update solicitudes_ajuste
      set estado='RECHAZADO', resuelto_por=p_dni, resuelto_en=now()
     where id = p_id;
  end if;

  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_solicitudes_listar(p_dni text, p_token uuid, p_area text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare quien operarios; res json; v_area text;
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  -- Endurecido (punto 7): la supervisora siempre ve su propia área.
  v_area := case when quien.cargo = 'SUPERVISORA' then quien.area_actual else p_area end;

  select coalesce(json_agg(json_build_object(
      'id', sa.id, 'dni', sa.dni, 'nombre', o.nombres_apellidos, 'area', sa.area,
      'fecha', to_char(sa.fecha,'YYYY-MM-DD'), 'minutos', sa.minutos, 'motivo', sa.motivo,
      'tipo', sa.tipo, 'solicitante', sol.nombres_apellidos,
      'hora', to_char(sa.creado at time zone 'America/Lima','HH24:MI'))
      order by sa.creado desc), '[]'::json)
    into res
  from solicitudes_ajuste sa
  join operarios o on o.dni = sa.dni
  left join operarios sol on sol.dni = sa.solicitante_dni
  where sa.estado = 'PENDIENTE'
    and (quien.cargo = 'INGENIERIA'
         or (sa.area = v_area and not coalesce(sa.solo_ingenieria, false)));

  return json_build_object('ok', true, 'items', res);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_permisos_guardar(p_dni text, p_token uuid, p_usuario text, p_areas jsonb, p_pestanas text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o operarios; u operarios;
begin
  o := _admin(p_dni, p_token);
  select * into u from operarios where dni = p_usuario;
  if not found then return json_build_object('ok', false, 'error', 'No existe ese usuario'); end if;
  if u.cargo in ('OPERARIO','ESTAJERO','SUPERVISORA') then
    return json_build_object('ok', false, 'error', 'Operarios y supervisoras no llevan estos permisos');
  end if;
  delete from permisos_area where dni = u.dni;
  insert into permisos_area (dni, area, nivel, asignado_por)
  select u.dni, e.key, e.value, o.dni
    from jsonb_each_text(coalesce(p_areas, '{}'::jsonb)) e
   where e.value in ('LEER','EDITAR') and trim(e.key) <> '';
  delete from permisos_pestana where dni = u.dni;
  insert into permisos_pestana (dni, pestana, asignado_por)
  select distinct u.dni, x, o.dni from unnest(coalesce(p_pestanas, '{}')) x where trim(x) <> '';
  return json_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_permisos_listar(p_dni text, p_token uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform _admin(p_dni, p_token);
  return coalesce((
    select json_agg(json_build_object(
      'dni', o.dni, 'nombre', o.nombres_apellidos, 'cargo', o.cargo, 'estado', o.estado,
      'admin', coalesce(o.es_admin, false),
      'areas', coalesce((select json_object_agg(area, nivel) from permisos_area pa where pa.dni = o.dni), '{}'::json),
      'pestanas', coalesce((select json_agg(pestana) from permisos_pestana pp where pp.dni = o.dni), '[]'::json))
      order by o.estado, o.dni)
    from operarios o
    where o.cargo not in ('OPERARIO','ESTAJERO','SUPERVISORA')), '[]'::json);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_mis_permisos(p_dni text, p_token uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return json_build_object(
    'admin', coalesce(o.es_admin, false),
    'areas', coalesce((select json_object_agg(area, nivel) from permisos_area where dni = o.dni), '{}'::json),
    'pestanas', coalesce((select json_agg(pestana order by pestana) from permisos_pestana where dni = o.dni), '[]'::json));
end $function$;

drop function if exists public._sol_areas(operarios);
drop function if exists public._aprueba(operarios, text);
drop function if exists public._sol_chica(text, integer);
commit;
