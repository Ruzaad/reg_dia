-- PARCHE 114 — Incidencias y reprocesos por área
-- 1) El pedido guarda dónde trabajó la persona, qué área causó el reproceso
--    y la OF; el visto bueno de la supervisora y el motivo del rechazo.
-- 2) La supervisora aprueba sola lo chico (MÁQUINA, MUESTRAS, ARREGLOS o
--    DESCOSER de hasta 60 min); al resto le da visto bueno o lo devuelve.
-- 3) En Ingeniería aprueba quien tiene "Aprueba" en esa área (Gestión ›
--    Permisos). Arranca con quien hoy edita: KROJAS en PANTALÓN y SACO,
--    LFABIAN en CAMISA; ALOPEZ todo. Pendientes: solo de tus áreas.
-- 4) La incidencia guarda el número de pedido; si se borra, el pedido queda
--    ANULADO (antes seguía "APROBADO").
-- 5) Lecturas nuevas: fn_solicitudes_panel (pendientes con cómo queda el día
--    y alertas, en una sola consulta), fn_solicitudes_mias (operario) y
--    fn_reprocesos_apoyo (en qué se fueron los minutos).
-- Incluye el bloqueo de copias del parche 113 para el pedido y la
-- aprobación, así que se puede correr con o sin él. Mismas firmas de antes
-- (los celulares con la versión vieja siguen funcionando).
-- Rollback: parche_114_rollback.sql.
begin;

alter table solicitudes_ajuste
  add column if not exists area_trabajo text,
  add column if not exists area_causa text,
  add column if not exists o_f text,
  add column if not exists visto_bueno_por text references operarios(dni),
  add column if not exists visto_bueno_en timestamptz,
  add column if not exists motivo_rechazo text;
alter table ocurrencias add column if not exists solicitud_id bigint;
alter table permisos_area add column if not exists aprueba boolean not null default false;

create index if not exists ocurrencias_solicitud_idx on ocurrencias(solicitud_id) where solicitud_id is not null;
create index if not exists solicitudes_ajuste_pend_idx on solicitudes_ajuste(area) where estado = 'PENDIENTE';
create index if not exists solicitudes_ajuste_dni_fecha_idx on solicitudes_ajuste(dni, fecha);

-- Arranque: aprueba quien hoy edita el área.
update permisos_area set aprueba = true where nivel = 'EDITAR' and not aprueba;

-- Enlace hacia atrás (90 días): la incidencia que nació de cada pedido aprobado.
update ocurrencias oc set solicitud_id = s.id
  from solicitudes_ajuste s
 where s.estado = 'APROBADO' and s.resuelto_en > now() - interval '90 days'
   and oc.solicitud_id is null
   and oc.dni = s.dni and oc.fecha = s.fecha and oc.area = s.area
   and oc.minutos = coalesce(s.minutos_final, s.minutos)
   and oc.supervisora_dni is not distinct from s.resuelto_por
   and abs(extract(epoch from oc.creado - s.resuelto_en)) < 10
   and not exists (select 1 from ocurrencias o2 where o2.solicitud_id = s.id);

-- Lo chico: lo aprueba la supervisora sola.
create or replace function public._sol_chica(p_tipo text, p_min integer)
 returns boolean language sql immutable as $$
  select upper(coalesce(p_tipo,'')) in ('MAQUINA','MUESTRAS','ARREGLOS','DESCOSER')
     and abs(coalesce(p_min,0)) between 1 and 60
$$;

-- ¿Puede aprobar incidencias de esa área? Administrador o "Aprueba".
create or replace function public._aprueba(o operarios, p_area text)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(o.es_admin,false)
      or exists (select 1 from permisos_area pa
                  where pa.dni = o.dni and pa.nivel = 'EDITAR' and pa.aprueba
                    and (pa.area = '*' or pa.area = p_area))
$$;
revoke all on function public._aprueba(operarios, text) from public, anon, authenticated;

-- Áreas que ve (null = todas). Supervisora: la suya.
create or replace function public._sol_areas(o operarios)
 returns text[] language sql stable security definer set search_path to 'public' as $$
  select case
    when o.cargo = 'SUPERVISORA' then array[o.area_actual]
    when coalesce(o.es_admin,false) or exists (select 1 from permisos_area where dni = o.dni and area = '*') then null
    else coalesce((select array_agg(area) from permisos_area where dni = o.dni), '{}') end
$$;
revoke all on function public._sol_areas(operarios) from public, anon, authenticated;

-- ---------- Pedir ----------
create or replace function public.fn_solicitud_ajuste_crear(p_dni text, p_token uuid, p_area text, p_minutos integer, p_motivo text, p_tipo text,
                                                            p_area_trabajo text, p_area_causa text, p_of text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare quien operarios; v_tipo text; v_motivo text; v_est text; v_prev solicitudes_ajuste;
        v_trab text := nullif(upper(trim(coalesce(p_area_trabajo,''))),'');
        v_causa text := nullif(upper(trim(coalesce(p_area_causa,''))),'');
        v_of text := nullif(upper(trim(coalesce(p_of,''))),'');
begin
  quien := _auth(p_dni, p_token);
  if p_minutos = 0 then return json_build_object('ok',false,'error','Los minutos no pueden ser 0'); end if;
  if abs(p_minutos) > 575 then return json_build_object('ok',false,'error','No puede pasar de 575 min (la jornada)'); end if;

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
  if v_tipo = 'OTROS' and v_motivo is null and v_trab is null then
    return json_build_object('ok',false,'error','Indica el motivo');
  end if;
  if v_motivo is null then
    v_motivo := case when v_trab is not null then 'TRABAJÉ EN '||v_trab else v_tipo end;
  end if;

  perform pg_advisory_xact_lock(hashtext('solicitud_ajuste:' || p_dni));
  select * into v_prev from solicitudes_ajuste
   where dni = p_dni and area = p_area and minutos = p_minutos and tipo = v_tipo and motivo = v_motivo
     and creado > now() - interval '2 minutes'
   order by creado desc limit 1;
  if found then
    return json_build_object('ok',true,'tipo',v_tipo,'repetido',true,
      'hace_s', greatest(0, round(extract(epoch from now() - v_prev.creado))));
  end if;

  insert into solicitudes_ajuste(dni, area, minutos, motivo, tipo, area_trabajo, area_causa, o_f)
  values (p_dni, p_area, p_minutos, v_motivo, v_tipo, v_trab, v_causa, v_of);
  return json_build_object('ok',true,'tipo',v_tipo);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' then raise; end if;
  return json_build_object('ok',false,'error',SQLERRM);
end $function$;

create or replace function public.fn_solicitud_ajuste_crear(p_dni text, p_token uuid, p_area text, p_minutos integer, p_motivo text, p_tipo text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  return fn_solicitud_ajuste_crear(p_dni, p_token, p_area, p_minutos, p_motivo, p_tipo, null::text, null::text, null::text);
end $function$;

-- ---------- Visto bueno o devolver (supervisora) ----------
create or replace function public.fn_solicitud_visto_bueno(p_dni text, p_token uuid, p_id bigint, p_ok boolean, p_motivo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare quien operarios; sol solicitudes_ajuste;
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo <> 'SUPERVISORA' then raise exception 'NO_AUTORIZADA'; end if;
  select * into sol from solicitudes_ajuste where id = p_id for update;
  if not found then return json_build_object('ok',false,'error','Pedido no encontrado'); end if;
  if sol.area <> quien.area_actual or coalesce(sol.solo_ingenieria,false) then raise exception 'NO_AUTORIZADA'; end if;
  if sol.estado <> 'PENDIENTE' then return json_build_object('ok',false,'error','Ya fue resuelto'); end if;
  if p_ok then
    if sol.visto_bueno_por is not null then return json_build_object('ok',true,'repetido',true); end if;
    update solicitudes_ajuste set visto_bueno_por = quien.dni, visto_bueno_en = now() where id = p_id;
  else
    if nullif(trim(coalesce(p_motivo,'')),'') is null then
      return json_build_object('ok',false,'error','Escribe por qué lo devuelves: el operario lo ve');
    end if;
    update solicitudes_ajuste
       set estado = 'DEVUELTO', motivo_rechazo = trim(p_motivo), resuelto_por = quien.dni, resuelto_en = now()
     where id = p_id;
  end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- Aprobar o rechazar ----------
create or replace function public.fn_solicitud_resolver(p_dni text, p_token uuid, p_id bigint, p_aprobar boolean, p_minutos_final integer, p_motivo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare quien operarios; sol solicitudes_ajuste; v_min int; v_tipo text; v_est text; v_copia bigint; v_oc bigint;
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;

  select * into sol from solicitudes_ajuste where id = p_id for update;
  if not found then return json_build_object('ok',false,'error','Solicitud no encontrada'); end if;
  if sol.estado <> 'PENDIENTE' then return json_build_object('ok',false,'error','Ya fue resuelta'); end if;

  v_min := coalesce(p_minutos_final, sol.minutos);
  if quien.cargo = 'SUPERVISORA' then
    if coalesce(sol.solo_ingenieria, false) or sol.area <> quien.area_actual then raise exception 'NO_AUTORIZADA'; end if;
    -- Lo que no es chico lo aprueba Ingeniería: aquí queda como visto bueno.
    if p_aprobar and not _sol_chica(sol.tipo, v_min) then
      update solicitudes_ajuste set visto_bueno_por = coalesce(visto_bueno_por, quien.dni),
             visto_bueno_en = coalesce(visto_bueno_en, now()) where id = p_id;
      return json_build_object('ok',false,'visto_bueno',true,'error',
        'Le diste visto bueno. Esta la aprueba Ingeniería (solo MÁQUINA, MUESTRAS, ARREGLOS o DESCOSER de hasta 60 min los apruebas tú).');
    end if;
  elsif not _aprueba(quien, sol.area) then
    raise exception 'NO_AUTORIZADA_AREA: no apruebas incidencias de %', sol.area;
  end if;

  if p_aprobar then
    v_est := _ausente_en(sol.dni, sol.fecha);
    if v_est is not null then
      return json_build_object('ok',false,'error',
        'El '||to_char(sol.fecha,'YYYY-MM-DD')||' esa persona está como '||v_est
        ||': no se puede aprobar. Corrige la asistencia o rechaza la solicitud.');
    end if;
    select s2.id into v_copia from solicitudes_ajuste s2
     where s2.id <> sol.id and s2.dni = sol.dni and s2.fecha = sol.fecha and s2.minutos = sol.minutos
       and s2.motivo is not distinct from sol.motivo and s2.estado = 'APROBADO'
       and abs(extract(epoch from s2.creado - sol.creado)) < 120
     limit 1;
    if v_copia is not null then
      return json_build_object('ok',false,'copia_de',v_copia,'error',
        'Es una copia de un pedido que ya aprobaste (llegó dos veces). Recházala para no descontar dos veces.');
    end if;
    if v_min = 0 then return json_build_object('ok',false,'error','Minutos no pueden ser 0'); end if;
    v_tipo := coalesce(nullif(trim(sol.tipo),''), _tipo_ajuste(sol.motivo));
    insert into ocurrencias (dni, area, tipo, minutos, detalle, supervisora_dni, fecha, solicitud_id)
    values (sol.dni, sol.area, v_tipo, v_min,
            coalesce(nullif(trim(sol.motivo),''), v_tipo), p_dni, sol.fecha, sol.id)
    returning id into v_oc;
    update solicitudes_ajuste
      set estado='APROBADO', minutos_final=v_min, resuelto_por=p_dni, resuelto_en=now(), motivo_rechazo=null
     where id = p_id;
  else
    update solicitudes_ajuste
      set estado='RECHAZADO', resuelto_por=p_dni, resuelto_en=now(),
          motivo_rechazo=nullif(trim(coalesce(p_motivo,'')),'')
     where id = p_id;
  end if;

  return json_build_object('ok', true, 'ocurrencia', v_oc);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_solicitud_resolver(p_dni text, p_token uuid, p_id bigint, p_aprobar boolean, p_minutos_final integer)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  return fn_solicitud_resolver(p_dni, p_token, p_id, p_aprobar, p_minutos_final, null::text);
end $function$;

-- ---------- Borrar o corregir la incidencia ----------
create or replace function public._ocurrencia_pedido()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    update solicitudes_ajuste
       set estado = 'ANULADO',
           motivo_rechazo = 'Se borró la incidencia el '||to_char(now() at time zone 'America/Lima','DD/MM HH24:MI')
             || coalesce(' ('||nullif(current_setting('app.motivo', true),'')||')','')
     where id = old.solicitud_id and estado = 'APROBADO';
    return old;
  end if;
  if new.minutos is distinct from old.minutos then
    update solicitudes_ajuste set minutos_final = new.minutos::int where id = new.solicitud_id and estado = 'APROBADO';
  end if;
  return new;
end $$;
drop trigger if exists ocurrencias_pedido on ocurrencias;
create trigger ocurrencias_pedido after delete or update of minutos on ocurrencias
  for each row when (old.solicitud_id is not null) execute function _ocurrencia_pedido();

-- ---------- Listas ----------
-- Lo de siempre (app vieja, Inicio y contadores), ahora solo de tus áreas.
-- La supervisora ya no ve lo que mandó a Ingeniería con visto bueno.
create or replace function public.fn_solicitudes_listar(p_dni text, p_token uuid, p_area text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare quien operarios; res json; v_areas text[];
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  v_areas := _sol_areas(quien);

  select coalesce(json_agg(json_build_object(
      'id', sa.id, 'dni', sa.dni, 'nombre', o.nombres_apellidos, 'area', sa.area,
      'fecha', to_char(sa.fecha,'YYYY-MM-DD'), 'minutos', sa.minutos, 'motivo', sa.motivo,
      'tipo', sa.tipo, 'solicitante', sol.nombres_apellidos,
      'hora', to_char(sa.creado at time zone 'America/Lima','HH24:MI'),
      'visto_bueno', sa.visto_bueno_por is not null)
      order by sa.creado desc), '[]'::json)
    into res
  from solicitudes_ajuste sa
  join operarios o on o.dni = sa.dni
  left join operarios sol on sol.dni = sa.solicitante_dni
  where sa.estado = 'PENDIENTE'
    and (v_areas is null or sa.area = any(v_areas))
    and (nullif(p_area,'') is null or quien.cargo = 'SUPERVISORA' or sa.area = p_area)
    and (quien.cargo = 'INGENIERIA'
         or (not coalesce(sa.solo_ingenieria, false) and sa.visto_bueno_por is null));

  return json_build_object('ok', true, 'items', res);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Panel: pendientes con cómo queda el día y alertas, más lo resuelto en los
-- últimos p_dias días (0 = solo pendientes). Una sola consulta.
create or replace function public.fn_solicitudes_panel(p_dni text, p_token uuid, p_area text, p_dias integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare quien operarios; v_areas text[]; res json; v_ap json;
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  v_areas := _sol_areas(quien);

  select coalesce(json_agg(x order by x->>'estado' <> 'PENDIENTE', x->>'area', (x->>'id')::bigint), '[]'::json) into res
  from (
    select json_build_object(
      'id', sa.id, 'dni', sa.dni, 'nombre', o.nombres_apellidos, 'cat', o.categoria, 'area', sa.area,
      'fecha', to_char(sa.fecha,'YYYY-MM-DD'), 'minutos', sa.minutos, 'minutos_final', sa.minutos_final,
      'motivo', sa.motivo, 'tipo', sa.tipo, 'estado', sa.estado,
      'pidio', to_char(sa.creado at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'solicitante', so.nombres_apellidos, 'solo_ing', coalesce(sa.solo_ingenieria,false),
      'area_trabajo', sa.area_trabajo, 'area_causa', sa.area_causa, 'o_f', sa.o_f,
      'visto_bueno', vb.nombres_apellidos,
      'visto_bueno_en', to_char(sa.visto_bueno_en at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'resuelto_por', rp.nombres_apellidos, 'resuelto_dni', sa.resuelto_por,
      'resuelto_en', to_char(sa.resuelto_en at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'motivo_rechazo', sa.motivo_rechazo,
      'chica', _sol_chica(sa.tipo, sa.minutos),
      'aprueba', case when quien.cargo = 'SUPERVISORA' then _sol_chica(sa.tipo, sa.minutos) and not coalesce(sa.solo_ingenieria,false)
                      else _aprueba(quien, sa.area) end,
      'reg', d.reg, 'inc', d.inc, 'he', d.he, 'pide', d.pide,
      'rep', (select json_build_object('id', s2.id, 'estado', s2.estado,
                       'hora', to_char(s2.creado at time zone 'America/Lima','HH24:MI'))
                from solicitudes_ajuste s2
               where sa.estado = 'PENDIENTE' and s2.id <> sa.id and s2.dni = sa.dni and s2.fecha = sa.fecha
                 and s2.minutos = sa.minutos and s2.tipo is not distinct from sa.tipo
                 and s2.motivo is not distinct from sa.motivo
                 and (s2.estado = 'APROBADO' or (s2.estado = 'PENDIENTE' and s2.id < sa.id))
               order by s2.estado = 'APROBADO' desc, s2.id limit 1),
      'igual', (select json_build_object('id', oc.id, 'por', coalesce(r2.nombres_apellidos, oc.supervisora_dni))
                  from ocurrencias oc left join operarios r2 on r2.dni = oc.supervisora_dni
                 where sa.estado = 'PENDIENTE' and oc.dni = sa.dni and oc.fecha = sa.fecha
                   and oc.tipo = sa.tipo and oc.minutos = sa.minutos and oc.solicitud_id is null
                 limit 1)) x
    from solicitudes_ajuste sa
    join operarios o on o.dni = sa.dni
    left join operarios so on so.dni = sa.solicitante_dni
    left join operarios vb on vb.dni = sa.visto_bueno_por
    left join operarios rp on rp.dni = sa.resuelto_por
    left join lateral (
      select (select coalesce(round(sum(r.minutos)),0) from reclamos r
               where r.dni = sa.dni and r.fecha = sa.fecha and r.estado = 'ACTIVO') reg,
             (select coalesce(sum(-oc.minutos) filter (where oc.minutos < 0),0) from ocurrencias oc
               where oc.dni = sa.dni and oc.fecha = sa.fecha) inc,
             (select coalesce(sum(oc.minutos) filter (where oc.minutos > 0),0) from ocurrencias oc
               where oc.dni = sa.dni and oc.fecha = sa.fecha) he,
             (select coalesce(sum(-s3.minutos) filter (where s3.minutos < 0),0) from solicitudes_ajuste s3
               where s3.dni = sa.dni and s3.fecha = sa.fecha and s3.estado = 'PENDIENTE') pide
      where sa.estado = 'PENDIENTE') d on true
    where (v_areas is null or sa.area = any(v_areas))
      and (nullif(p_area,'') is null or quien.cargo = 'SUPERVISORA' or sa.area = p_area)
      and (quien.cargo = 'INGENIERIA' or not coalesce(sa.solo_ingenieria,false))
      and (sa.estado = 'PENDIENTE'
           or (coalesce(p_dias,0) > 0 and sa.resuelto_en > now() - make_interval(days => least(p_dias, 31))))
  ) t;

  return json_build_object('ok', true, 'items', res,
    'cargo', quien.cargo, 'admin', coalesce(quien.es_admin,false));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Operario: lo que pidió en los últimos 16 días y en qué va.
create or replace function public.fn_solicitudes_mias(p_dni text, p_token uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object(
      'id', sa.id, 'fecha', to_char(sa.fecha,'YYYY-MM-DD'), 'minutos', sa.minutos,
      'minutos_final', sa.minutos_final, 'motivo', sa.motivo, 'tipo', sa.tipo, 'estado', sa.estado,
      'pidio', to_char(sa.creado at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'area_trabajo', sa.area_trabajo, 'area_causa', sa.area_causa, 'o_f', sa.o_f,
      'visto_bueno', sa.visto_bueno_por is not null,
      'resuelto_por', rp.nombres_apellidos, 'resuelto_sup', rp.cargo = 'SUPERVISORA',
      'resuelto_en', to_char(sa.resuelto_en at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'motivo_rechazo', sa.motivo_rechazo,
      'chica', _sol_chica(sa.tipo, sa.minutos), 'solo_ing', coalesce(sa.solo_ingenieria,false))
      order by sa.creado desc)
    from solicitudes_ajuste sa
    left join operarios rp on rp.dni = sa.resuelto_por
    where sa.dni = o.dni and sa.fecha >= _hoy() - 16), '[]'::json));
end $function$;

-- En qué se fueron los minutos de incidencia (sin horas extra). Solo lectura.
create or replace function public.fn_reprocesos_apoyo(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o operarios; v_areas text[];
begin
  o := _lector(p_dni, p_token, nullif(p_area,''));
  v_areas := _sol_areas(o);
  if p_hasta - p_desde > 93 then return json_build_object('ok',false,'error','Elige un rango de hasta 3 meses'); end if;
  return (
    with b as (
      select oc.dni, oc.area, oc.fecha, -oc.minutos m, oc.tipo,
             upper(coalesce(oc.detalle,'')) det, s.area_trabajo, s.area_causa, s.o_f
        from ocurrencias oc
        left join solicitudes_ajuste s on s.id = oc.solicitud_id
       where oc.fecha between p_desde and p_hasta and oc.minutos < 0
         and (v_areas is null or oc.area = any(v_areas))
         and (nullif(p_area,'') is null or oc.area = p_area)
    ), c as (
      select *, case
        when area_trabajo = 'DESPACHO' or det ~ 'DESPACH' then 'Despacho'
        when area_trabajo = 'REPROCESO' or tipo = 'REPROCESOS' or det ~ 'REPROCES' then 'Reproceso'
        when area_trabajo is not null or det ~ '(APOYO|AYUD|HABILIT)' then 'Apoyo a otra área'
        when det ~ '(LIQUID|LIKID)' then 'Liquidación'
        when det ~ '(NUEV|CAPACIT|APREND|INDUCC)' then 'Personal nuevo'
        when tipo in ('TARDANZA','SEGURO','PERMISO','PAGO_HORA') then 'Permisos y salidas'
        when tipo in ('ARREGLOS','DESCOSER') then 'Arreglos'
        when tipo = 'MUESTRAS' then 'Muestras'
        when tipo = 'MAQUINA' then 'Máquina parada'
        else 'Otros' end cat
      from b
    )
    select json_build_object('ok', true,
      'total', coalesce((select sum(m) from c),0),
      'otra_cosa', coalesce((select sum(m) from c where cat in ('Despacho','Reproceso','Apoyo a otra área','Liquidación')),0),
      'maquina', coalesce((select sum(m) from c where cat = 'Máquina parada'),0),
      'dias_enteros', (select count(*) from (select dni, fecha from c group by 1,2 having sum(m) >= 575) z),
      'cats', coalesce((select json_agg(json_build_object('cat', cat, 'min', mi, 'personas', pe) order by mi desc)
                          from (select cat, sum(m) mi, count(distinct dni) pe from c group by cat) z), '[]'::json),
      'por_area', coalesce((select json_agg(json_build_object('cat', cat, 'area', area, 'min', mi))
                              from (select cat, area, sum(m) mi from c group by cat, area) z), '[]'::json),
      'causa', coalesce((select json_agg(json_build_object('causa', area_causa, 'area', area, 'min', mi, 'ofs', ofs) order by mi desc)
                           from (select area_causa, area, sum(m) mi, array_remove(array_agg(distinct o_f), null) ofs
                                   from c where area_causa is not null group by 1,2) z), '[]'::json),
      'sin_causa', (select count(*) from c where cat = 'Reproceso' and area_causa is null))
  );
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- Permisos: nivel "Aprueba" ----------
create or replace function public.fn_permisos_guardar(p_dni text, p_token uuid, p_usuario text, p_areas jsonb, p_pestanas text[])
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o operarios; u operarios;
begin
  o := _admin(p_dni, p_token);
  select * into u from operarios where dni = p_usuario;
  if not found then return json_build_object('ok', false, 'error', 'No existe ese usuario'); end if;
  if u.cargo in ('OPERARIO','ESTAJERO','SUPERVISORA') then
    return json_build_object('ok', false, 'error', 'Operarios y supervisoras no llevan estos permisos');
  end if;
  delete from permisos_area where dni = u.dni;
  -- APRUEBA = edita el área y además aprueba sus incidencias.
  insert into permisos_area (dni, area, nivel, aprueba, asignado_por)
  select u.dni, e.key, case when e.value = 'APRUEBA' then 'EDITAR' else e.value end, e.value = 'APRUEBA', o.dni
    from jsonb_each_text(coalesce(p_areas, '{}'::jsonb)) e
   where e.value in ('LEER','EDITAR','APRUEBA') and trim(e.key) <> '';
  delete from permisos_pestana where dni = u.dni;
  insert into permisos_pestana (dni, pestana, asignado_por)
  select distinct u.dni, x, o.dni from unnest(coalesce(p_pestanas, '{}')) x where trim(x) <> '';
  return json_build_object('ok', true);
end $function$;

create or replace function public.fn_permisos_listar(p_dni text, p_token uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform _admin(p_dni, p_token);
  return coalesce((
    select json_agg(json_build_object(
      'dni', o.dni, 'nombre', o.nombres_apellidos, 'cargo', o.cargo, 'estado', o.estado,
      'admin', coalesce(o.es_admin, false),
      'areas', coalesce((select json_object_agg(area, nivel) from permisos_area pa where pa.dni = o.dni), '{}'::json),
      'aprueba', coalesce((select json_agg(area) from permisos_area pa where pa.dni = o.dni and pa.aprueba), '[]'::json),
      'pestanas', coalesce((select json_agg(pestana) from permisos_pestana pp where pp.dni = o.dni), '[]'::json))
      order by o.estado, o.dni)
    from operarios o
    where o.cargo not in ('OPERARIO','ESTAJERO','SUPERVISORA')), '[]'::json);
end $function$;

create or replace function public.fn_mis_permisos(p_dni text, p_token uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return json_build_object(
    'admin', coalesce(o.es_admin, false),
    'areas', coalesce((select json_object_agg(area, nivel) from permisos_area where dni = o.dni), '{}'::json),
    'aprueba', coalesce((select json_agg(area) from permisos_area where dni = o.dni and aprueba), '[]'::json),
    'pestanas', coalesce((select json_agg(pestana order by pestana) from permisos_pestana where dni = o.dni), '[]'::json));
end $function$;

commit;
