-- PARCHE 113 — Bloquear copias en la base
-- 1) fn_solicitud_ajuste_crear: si llega el mismo pedido (misma persona,
--    minutos, tipo y motivo) en menos de 2 minutos, no crea otro: responde
--    "ya lo enviaste". Un candado por persona evita que 11 toques en 0.25 s
--    creen 11 pedidos.
-- 2) fn_solicitud_resolver: bloquea la fila antes de resolver (un doble clic
--    en APROBAR ya no aplica dos veces) y no deja aprobar la copia de un
--    pedido que ya se aprobó.
-- 3) fn_acabado_registrar: bloquea la OF y operación mientras revisa cuánto
--    queda del corte (dos registros a la vez ya no se pasan), y si la misma
--    persona repite la misma cantidad en menos de 5 s lo toma como reintento.
-- Mismas firmas: protege también a los celulares con la versión vieja
-- (Netlify). No cambia tablas ni cálculos. Rollback: parche_113_rollback.sql.
begin;

create or replace function public.fn_solicitud_ajuste_crear(p_dni text, p_token uuid, p_area text, p_minutos integer, p_motivo text, p_tipo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare quien operarios; v_tipo text; v_motivo text; v_est text; v_prev solicitudes_ajuste;
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

  v_tipo := upper(coalesce(nullif(trim(p_tipo),''), ''));
  if v_tipo not in ('MAQUINA','ARREGLOS','MUESTRAS','REPROCESOS','DESCOSER','OTROS') then
    v_tipo := _tipo_ajuste(p_motivo);
  end if;
  v_motivo := nullif(trim(p_motivo),'');
  if v_tipo = 'OTROS' and v_motivo is null then
    return json_build_object('ok',false,'error','Indica el motivo');
  end if;
  if v_motivo is null then v_motivo := v_tipo; end if;

  -- Parche 113: un pedido a la vez por persona, y sin copias en 2 minutos.
  perform pg_advisory_xact_lock(hashtext('solicitud_ajuste:' || p_dni));
  select * into v_prev from solicitudes_ajuste
   where dni = p_dni and area = p_area and minutos = p_minutos and tipo = v_tipo and motivo = v_motivo
     and creado > now() - interval '2 minutes'
   order by creado desc limit 1;
  if found then
    return json_build_object('ok',true,'tipo',v_tipo,'repetido',true,
      'hace_s', greatest(0, round(extract(epoch from now() - v_prev.creado))));
  end if;

  insert into solicitudes_ajuste(dni, area, minutos, motivo, tipo)
  values (p_dni, p_area, p_minutos, v_motivo, v_tipo);
  return json_build_object('ok',true,'tipo',v_tipo);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' then raise; end if;
  return json_build_object('ok',false,'error',SQLERRM);
end $function$;

create or replace function public.fn_solicitud_resolver(p_dni text, p_token uuid, p_id bigint, p_aprobar boolean, p_minutos_final integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare quien operarios; sol solicitudes_ajuste; v_min int; v_tipo text; v_est text; v_copia bigint;
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;

  -- Parche 113: la fila queda bloqueada hasta terminar; un segundo clic espera
  -- y luego ve "Ya fue resuelta".
  select * into sol from solicitudes_ajuste where id = p_id for update;
  if not found then return json_build_object('ok',false,'error','Solicitud no encontrada'); end if;
  if sol.estado <> 'PENDIENTE' then return json_build_object('ok',false,'error','Ya fue resuelta'); end if;

  if coalesce(sol.solo_ingenieria, false) and quien.cargo <> 'INGENIERIA' then
    raise exception 'NO_AUTORIZADA';
  end if;
  if quien.cargo = 'SUPERVISORA' and sol.area <> quien.area_actual then
    raise exception 'NO_AUTORIZADA';
  end if;

  if p_aprobar then
    v_est := _ausente_en(sol.dni, sol.fecha);
    if v_est is not null then
      return json_build_object('ok',false,'error',
        'El '||to_char(sol.fecha,'YYYY-MM-DD')||' esa persona está como '||v_est
        ||': no se puede aprobar. Corrige la asistencia o rechaza la solicitud.');
    end if;
    -- Parche 113: copia de un pedido ya aprobado (mismo día, minutos y motivo,
    -- enviado con menos de 2 minutos de diferencia).
    select s2.id into v_copia from solicitudes_ajuste s2
     where s2.id <> sol.id and s2.dni = sol.dni and s2.fecha = sol.fecha and s2.minutos = sol.minutos
       and s2.motivo is not distinct from sol.motivo and s2.estado = 'APROBADO'
       and abs(extract(epoch from s2.creado - sol.creado)) < 120
     limit 1;
    if v_copia is not null then
      return json_build_object('ok',false,'copia_de',v_copia,'error',
        'Es una copia de un pedido que ya aprobaste (llegó dos veces). Recházala para no descontar dos veces.');
    end if;
    v_min := coalesce(p_minutos_final, sol.minutos);
    if v_min = 0 then return json_build_object('ok',false,'error','Minutos no pueden ser 0'); end if;
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

create or replace function public.fn_acabado_registrar(p_dni text, p_token uuid, p_area text, p_of text, p_nop integer, p_cant numeric, p_causa text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o operarios; f ofs; ru record; v_hecho numeric; v_queda numeric;
        v_causa text; v_delta numeric := 0; v_std numeric; v_prev reclamos;
begin
  o := _auth(p_dni, p_token);
  if coalesce(p_cant,0) <= 0 then
    return json_build_object('ok',false,'error','Indica una cantidad mayor que cero'); end if;

  select * into f from ofs where _nk(o_f) = _nk(p_of);
  if not found then
    return json_build_object('ok',false,'error','La OF '||coalesce(p_of,'')||' no está registrada. Dala de alta en OFs registradas.'); end if;

  select b.modulo, b.operacion, b.std into ru
    from bases b
   where b.area = p_area and _nk(b.articulo) = _nk(f.articulo) and b.n_op = p_nop
   order by b.id limit 1;
  if not found then
    return json_build_object('ok',false,'error','Esa operación no está en la BASE de '||p_area); end if;

  if _modulo_cerrado(p_area, f.o_f, ru.modulo) then
    return json_build_object('ok',false,'error',
      'El módulo '||ru.modulo||' (OF '||f.o_f||') está cerrado por ingeniería.'); end if;

  v_causa := nullif(upper(trim(coalesce(p_causa,''))), '');
  if v_causa is not null then
    select c.delta into v_delta from causas_std c where c.texto = v_causa and c.activa;
    if not found then
      return json_build_object('ok',false,'error','Esa causa no existe o está desactivada'); end if;
  end if;
  v_std := ru.std + coalesce(v_delta,0);
  if v_std <= 0 then
    return json_build_object('ok',false,'error','La causa deja el STD en cero o negativo'); end if;

  -- Parche 113: una operación de una OF a la vez, para que el "cuánto queda"
  -- no lo lean dos registros al mismo tiempo.
  perform pg_advisory_xact_lock(hashtext('acabado:' || p_area || ':' || f.o_f || ':' || p_nop));

  -- Reintento: la misma persona, misma OF, operación y cantidad hace menos de 5 s.
  select * into v_prev from reclamos
   where dni = o.dni and area = p_area and o_f = f.o_f and nop = p_nop and cant = p_cant
     and estado = 'ACTIVO' and creado > now() - interval '5 seconds'
   order by creado desc limit 1;
  if found then
    select coalesce(sum(cant),0) into v_hecho from reclamos
     where area = p_area and _nk(o_f) = _nk(f.o_f) and nop = p_nop and estado = 'ACTIVO';
    return (jsonb_build_object('ok', true, 'repetido', true, 'hecho', round(v_hecho,0),
            'cant_prog', round(f.cant_prog,0), 'causa', v_prev.causa) || fn_mi_dia(p_dni, p_token)::jsonb)::json;
  end if;

  select coalesce(sum(cant),0) into v_hecho from reclamos
   where area = p_area and _nk(o_f) = _nk(f.o_f) and nop = p_nop and estado = 'ACTIVO';
  v_queda := f.cant_prog - v_hecho;
  if p_cant > v_queda then
    return json_build_object('ok',false,'error',
      'Pasa del corte real: van '||round(v_hecho,0)||' de '||round(f.cant_prog,0)||
      case when v_queda > 0 then ', quedan '||round(v_queda,0) else ', ya está completa' end);
  end if;

  insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant, articulo, nop,
                        causa, std_base)
  values (null, o.dni, p_area, f.o_f, ru.modulo, ru.operacion, v_std, p_cant, f.articulo, p_nop,
          v_causa, case when v_causa is null then null else ru.std end);

  return (jsonb_build_object('ok', true, 'hecho', round(v_hecho + p_cant,0),
          'cant_prog', round(f.cant_prog,0), 'causa', v_causa) || fn_mi_dia(p_dni, p_token)::jsonb)::json;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- La sobrecarga vieja de 6 argumentos (despliegues sin migrar) pasa por la nueva.
create or replace function public.fn_acabado_registrar(p_dni text, p_token uuid, p_area text, p_of text, p_nop integer, p_cant numeric)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return fn_acabado_registrar(p_dni, p_token, p_area, p_of, p_nop, p_cant, null::text);
end $function$;

commit;
