-- PARCHE 101 — Las pantallas del administrador se pueden dar por área
--
-- Hasta el parche 95, Auditoría, Incentivos (con bono modular, eficiencia
-- manual y minutos de consideración) e Historial de tiempos de BASE eran solo
-- del administrador maestro: sus 18 RPC validaban con _admin. Ahora:
--
--   · Se asignan desde Gestión › Permisos como cualquier otra pestaña
--     (permisos_pestana: pasoAudit, pasoInc, pasoBaseLog).
--   · Quien las tenga ve solo las áreas que lee y corrige solo las que edita
--     (permisos_area). "Todas las áreas" exige '*', igual que _lector.
--   · Corregir o eliminar incidencias deja de valer para cualquier usuario de
--     INGENIERIA: hace falta la pestaña Incidencias o Auditoría y edición en el
--     área de la incidencia (antes y después del cambio).
--   · Cada corrección hecha por un usuario de oficina queda en
--     correcciones_log (quién, cuándo, qué tabla, antes y después). El
--     administrador la ve en la pestaña nueva Gestión › Correcciones, junto con
--     los cambios de tiempos de BASE que ya guardaba bases_log.
--   · Permisos y Correcciones siguen siendo solo del administrador.
--
-- Re-ejecutable. Vuelta atrás: sql/parche_101_rollback.sql.
begin;

-- ---------- 1. Validación por pestaña y área ----------
-- p_pestanas: basta con tener una. p_area: null = no mira área (tablas de
-- tarifas); '' = todas las áreas, exige '*'; 'X' = exige leer X o '*'.
create or replace function public._vista(p_dni text, p_token uuid, p_pestanas text[], p_area text default null)
returns operarios
language plpgsql security definer set search_path to 'public'
as $$
declare o operarios; a text;
begin
  o := _auth(p_dni, p_token);
  if coalesce(o.es_admin, false) then return o; end if;
  if o.cargo in ('OPERARIO','ESTAJERO','SUPERVISORA') then raise exception 'NO_AUTORIZADA'; end if;
  if not exists (select 1 from permisos_pestana where dni = o.dni and pestana = any(p_pestanas)) then
    raise exception 'NO_AUTORIZADA: el administrador no te dio esta pestaña';
  end if;
  if p_area is not null then
    a := nullif(trim(p_area), '');
    if not exists (select 1 from permisos_area where dni = o.dni and (area = '*' or area = a)) then
      raise exception 'NO_AUTORIZADA_AREA: sin acceso a %', coalesce(a, 'todas las áreas');
    end if;
  end if;
  return o;
end $$;
revoke execute on function public._vista(text, uuid, text[], text) from public, anon, authenticated;

-- Basta con una de las áreas. Sin área conocida exige '*'.
create or replace function public._vista_area(o operarios, p_areas text[], p_editar boolean)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare v text[];
begin
  if coalesce(o.es_admin, false) then return; end if;
  select array_agg(distinct x) into v from unnest(coalesce(p_areas, '{}')) x where nullif(trim(x), '') is not null;
  if not exists (select 1 from permisos_area
                  where dni = o.dni and (area = '*' or area = any(coalesce(v, '{}')))
                    and (not p_editar or nivel = 'EDITAR')) then
    raise exception 'NO_AUTORIZADA_AREA: % %',
      case when p_editar then 'solo lectura en' else 'sin acceso a' end,
      coalesce(array_to_string(v, ' / '), 'todas las áreas');
  end if;
end $$;
revoke execute on function public._vista_area(operarios, text[], boolean) from public, anon, authenticated;

-- ---------- 2. Registro de correcciones ----------
create table if not exists public.correcciones_log (
  id      bigserial primary key,
  creado  timestamptz not null default now(),
  dni     text not null,          -- quién corrigió
  tabla   text not null,
  accion  text not null,          -- INSERT / UPDATE / DELETE
  area    text,
  dni_op  text,                   -- a quién afecta (null en el bono modular, que es del área)
  fecha   date,
  antes   jsonb,
  despues jsonb
);
create index if not exists correcciones_log_creado_idx on public.correcciones_log (creado);
alter table public.correcciones_log enable row level security;
revoke all on public.correcciones_log from anon, authenticated;

-- Solo registra lo que hace un usuario de oficina (app.dni lo deja _auth).
-- Operarios y supervisoras no pasan por aquí.
create or replace function public._correccion_log_trg()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_dni text := nullif(current_setting('app.dni', true), '');
  r jsonb; v_op text; v_area text;
begin
  if v_dni is null then return null; end if;
  if not exists (select 1 from operarios where dni = v_dni
                  and cargo not in ('OPERARIO','ESTAJERO','SUPERVISORA')) then return null; end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return null; end if;
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_op := r->>'dni';
  v_area := r->>'area';
  if v_area is null and v_op is not null then
    select area_origen into v_area from operarios where dni = v_op;
  end if;
  insert into correcciones_log (dni, tabla, accion, area, dni_op, fecha, antes, despues)
  values (v_dni, tg_table_name, tg_op, v_area, v_op,
          coalesce(r->>'fecha', r->>'desde')::date,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
revoke execute on function public._correccion_log_trg() from public, anon, authenticated;

-- Incidencias: solo cambios y borrados (crearlas es el trabajo diario).
drop trigger if exists correccion_log_trg on public.ocurrencias;
create trigger correccion_log_trg after update or delete on public.ocurrencias
  for each row execute function _correccion_log_trg();
drop trigger if exists correccion_log_trg on public.eficiencia_manual;
create trigger correccion_log_trg after insert or update or delete on public.eficiencia_manual
  for each row execute function _correccion_log_trg();
drop trigger if exists correccion_log_trg on public.minutos_consideracion;
create trigger correccion_log_trg after insert or update or delete on public.minutos_consideracion
  for each row execute function _correccion_log_trg();
drop trigger if exists correccion_log_trg on public.bono_modular_dia;
create trigger correccion_log_trg after insert or update or delete on public.bono_modular_dia
  for each row execute function _correccion_log_trg();
drop trigger if exists correccion_log_trg on public.bono_modular_override;
create trigger correccion_log_trg after insert or update or delete on public.bono_modular_override
  for each row execute function _correccion_log_trg();

-- Lo que ve el administrador: este registro más los cambios de BASE (parche 86).
create or replace function public.fn_correcciones_listar(p_dni text, p_token uuid, p_desde date, p_hasta date)
returns json
language plpgsql security definer set search_path to 'public'
set statement_timeout to '30s'
as $$
declare v json;
begin
  perform _admin(p_dni, p_token);
  if p_hasta < p_desde then
    return json_build_object('ok', false, 'error', 'La fecha final no puede ser menor a la inicial');
  end if;
  if (p_hasta - p_desde) > 185 then
    return json_build_object('ok', false, 'error', 'Rango máximo 6 meses');
  end if;
  with t as (
    select c.creado, c.id, c.dni, c.tabla, c.accion, c.area, c.dni_op, c.fecha, c.antes, c.despues
      from correcciones_log c
     where c.creado >= (p_desde::timestamp at time zone 'America/Lima')
       and c.creado <  ((p_hasta + 1)::timestamp at time zone 'America/Lima')
    union all
    select l.creado, l.id, l.dni, 'bases', l.accion, l.area, null, null,
           case when l.std_antes is not null then jsonb_build_object('articulo', l.articulo, 'modulo', l.modulo,
             'n_op', l.n_op, 'operacion', l.operacion, 'std', l.std_antes) end,
           case when l.std_despues is not null then jsonb_build_object('articulo', l.articulo, 'modulo', l.modulo,
             'n_op', l.n_op, 'operacion', l.operacion, 'std', l.std_despues) end
      from bases_log l
     where l.creado >= (p_desde::timestamp at time zone 'America/Lima')
       and l.creado <  ((p_hasta + 1)::timestamp at time zone 'America/Lima')
  )
  select coalesce(json_agg(json_build_object(
           'hora', to_char(t.creado at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'),
           'dni', t.dni, 'nombre', u.nombres_apellidos, 'admin', coalesce(u.es_admin, false),
           'tabla', t.tabla, 'accion', t.accion, 'area', t.area,
           'dni_op', t.dni_op, 'nombre_op', op.nombres_apellidos,
           'fecha', to_char(t.fecha, 'YYYY-MM-DD'), 'antes', t.antes, 'despues', t.despues)
           order by t.creado desc, t.id desc), '[]'::json)
    into v
    from t
    left join operarios u  on u.dni  = t.dni
    left join operarios op on op.dni = t.dni_op;
  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;
revoke all on function public.fn_correcciones_listar(text, uuid, date, date) from public;
grant execute on function public.fn_correcciones_listar(text, uuid, date, date) to anon, authenticated;

-- ---------- 3. RPC de lectura: se cambia solo la primera línea ----------
-- Estas funciones son largas y su cuerpo no cambia: se reemplaza
-- "perform _admin(p_dni, p_token);" por la validación nueva sobre la
-- definición que ya está en la base. Si la línea no está (ya se corrió el
-- parche), se salta.
do $$
declare f record; d text; nuevo text;
begin
  for f in select * from (values
    ('fn_ef_auditoria',             'perform _vista(p_dni, p_token, array[''pasoAudit''], coalesce(p_area, ''''));'),
    ('fn_ef_auditoria_v2',          'perform _vista(p_dni, p_token, array[''pasoAudit''], coalesce(p_area, ''''));'),
    ('fn_ef_auditoria_detalle',     'perform _vista_area(_vista(p_dni, p_token, array[''pasoAudit''], null), (select array[x.area_origen, x.area_actual] from operarios x where x.dni = p_dni_op), false);'),
    ('fn_ef_auditoria_ops',         'perform _vista_area(_vista(p_dni, p_token, array[''pasoAudit''], null), (select array[x.area_origen, x.area_actual] from operarios x where x.dni = p_dni_op), false);'),
    ('fn_incentivos_quincena',      'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_incentivos_tabla_listar',  'perform _vista(p_dni, p_token, array[''pasoInc''], null);'),
    ('fn_bono_modular_tabla_listar','perform _vista(p_dni, p_token, array[''pasoInc''], null);'),
    ('fn_bono_modular_listar',      'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_ef_manual_listar',         'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_ef_tickets_rango',         'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_consideracion_listar',     'perform _vista(p_dni, p_token, array[''pasoInc''], coalesce(p_area, ''''));'),
    ('fn_bases_log',                'perform _vista(p_dni, p_token, array[''pasoBaseLog''], coalesce(p_area, ''''));')
  ) z(nombre, linea) loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = f.nombre;
    if d is null then raise exception 'Parche 101: no existe %', f.nombre; end if;
    if position(f.linea in d) > 0 then continue; end if;             -- ya aplicado
    if position('perform _admin(p_dni, p_token);' in d) = 0 then
      raise exception 'Parche 101: % no valida con _admin como se esperaba', f.nombre;
    end if;
    nuevo := replace(d, 'perform _admin(p_dni, p_token);', f.linea);
    execute nuevo;
  end loop;
end $$;

-- ---------- 4. RPC que escriben: validan el área de cada fila ----------
-- Los permisos de ejecución no cambian (create or replace los conserva).

create or replace function public.fn_bono_modular_guardar(p_dni text, p_token uuid, p_cambios jsonb)
 returns json
 language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; c jsonb; v_area text; v_fecha date; v_pct numeric;
        n_up int := 0; n_del int := 0;
begin
  s := _vista(p_dni, p_token, array['pasoInc'], null);
  for c in select value from jsonb_array_elements(coalesce(p_cambios,'[]'::jsonb)) loop
    v_area  := nullif(trim(coalesce(c->>'area','')), '');
    v_fecha := (c->>'fecha')::date;
    if v_area is null or v_fecha is null then continue; end if;
    perform _vista_area(s, array[v_area], true);
    v_pct := nullif(trim(coalesce(c->>'pct','')), '')::numeric;
    if v_pct is null then
      delete from bono_modular_dia where area = v_area and fecha = v_fecha;
      n_del := n_del + 1;
    else
      insert into bono_modular_dia (area, fecha, pct, registrado_por)
      values (v_area, v_fecha, v_pct, s.dni)
      on conflict (area, fecha) do update
        set pct = excluded.pct, registrado_por = excluded.registrado_por, creado = now();
      n_up := n_up + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'guardados', n_up, 'borrados', n_del);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_bono_modular_override(p_dni text, p_token uuid, p_dni_op text, p_desde date, p_hasta date, p_forzar boolean)
 returns json
 language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios;
begin
  s := _vista(p_dni, p_token, array['pasoInc'], null);
  if coalesce(trim(p_dni_op),'') = '' or p_desde is null or p_hasta is null then
    return json_build_object('ok', false, 'error', 'Faltan persona o rango');
  end if;
  perform _vista_area(s, (select array[x.area_origen] from operarios x where x.dni = trim(p_dni_op)), true);
  if p_forzar is null then
    delete from bono_modular_override
     where dni = trim(p_dni_op) and desde = p_desde and hasta = p_hasta;
    return json_build_object('ok', true, 'forzar', null);
  end if;
  insert into bono_modular_override (dni, desde, hasta, forzar, registrado_por)
  values (trim(p_dni_op), p_desde, p_hasta, p_forzar, s.dni)
  on conflict (dni, desde, hasta) do update
    set forzar = excluded.forzar, registrado_por = excluded.registrado_por, creado = now();
  return json_build_object('ok', true, 'forzar', p_forzar);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_ef_manual_guardar(p_dni text, p_token uuid, p_cambios jsonb)
 returns json
 language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; c jsonb; v_d text; v_f date; v_pct numeric;
        n_up int := 0; n_del int := 0;
begin
  s := _vista(p_dni, p_token, array['pasoInc'], null);
  for c in select value from jsonb_array_elements(coalesce(p_cambios,'[]'::jsonb)) loop
    v_d := nullif(trim(coalesce(c->>'dni','')), '');
    v_f := (c->>'fecha')::date;
    if v_d is null or v_f is null then continue; end if;
    perform _vista_area(s, (select array[x.area_origen] from operarios x where x.dni = v_d), true);
    v_pct := nullif(trim(coalesce(c->>'pct','')), '')::numeric;
    if v_pct is null then
      delete from eficiencia_manual where dni = v_d and fecha = v_f;
      n_del := n_del + 1;
    else
      insert into eficiencia_manual (dni, fecha, pct, registrado_por)
      values (v_d, v_f, v_pct, s.dni)
      on conflict (dni, fecha) do update
        set pct = excluded.pct, registrado_por = excluded.registrado_por, creado = now();
      n_up := n_up + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'guardados', n_up, 'borrados', n_del);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_consideracion_guardar(p_dni text, p_token uuid, p_id bigint, p_dni_op text, p_fecha date, p_minutos numeric, p_motivo text)
 returns json
 language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; v_id bigint;
begin
  s := _vista(p_dni, p_token, array['pasoInc'], null);
  if coalesce(trim(p_dni_op),'') = '' or p_fecha is null then
    return json_build_object('ok', false, 'error', 'Persona y fecha son obligatorias');
  end if;
  if coalesce(p_minutos,0) = 0 then
    return json_build_object('ok', false, 'error', 'Los minutos no pueden ser cero');
  end if;
  if not exists (select 1 from operarios where dni = p_dni_op) then
    return json_build_object('ok', false, 'error', 'No existe esa persona');
  end if;
  perform _vista_area(s, (select array[x.area_origen] from operarios x where x.dni = trim(p_dni_op)), true);
  if p_id is not null then
    perform _vista_area(s, (select array[x.area_origen] from minutos_consideracion c
                              join operarios x on x.dni = c.dni where c.id = p_id), true);
  end if;
  if p_id is null then
    insert into minutos_consideracion (dni, fecha, minutos, motivo, registrado_por)
    values (trim(p_dni_op), p_fecha, p_minutos, nullif(trim(coalesce(p_motivo,'')),''), s.dni)
    returning id into v_id;
  else
    update minutos_consideracion
       set dni = trim(p_dni_op), fecha = p_fecha, minutos = p_minutos,
           motivo = nullif(trim(coalesce(p_motivo,'')),''), registrado_por = s.dni
     where id = p_id
    returning id into v_id;
    if v_id is null then return json_build_object('ok', false, 'error', 'No existe esa línea'); end if;
  end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_consideracion_eliminar(p_dni text, p_token uuid, p_id bigint)
 returns json
 language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; n int;
begin
  s := _vista(p_dni, p_token, array['pasoInc'], null);
  if not exists (select 1 from minutos_consideracion where id = p_id) then
    return json_build_object('ok', false, 'error', 'No existe esa línea');
  end if;
  perform _vista_area(s, (select array[x.area_origen] from minutos_consideracion c
                            join operarios x on x.dni = c.dni where c.id = p_id), true);
  delete from minutos_consideracion where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', false, 'error', 'No existe esa línea'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Incidencias: antes bastaba con ser de INGENIERIA (_ing). Ahora hace falta la
-- pestaña Incidencias o Auditoría y editar el área de la incidencia; si cambia
-- de persona, también la del área nueva.
create or replace function public.fn_ocurrencia_editar(p_dni text, p_token uuid, p_id bigint, p_dni_op text, p_tipo text, p_minutos numeric, p_fecha date, p_detalle text)
 returns json
 language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; v_area text; v_fecha date; v_est text; v_dni_ant text; v_area_ant text;
begin
  s := _vista(p_dni, p_token, array['pasoIncid','pasoAudit'], null);
  if p_minutos = 0 then return json_build_object('ok', false, 'error', 'Minutos no puede ser 0'); end if;
  if p_tipo not in ('MAQUINA','HORA_EXTRA','PAGO_HORA','TARDANZA','SEGURO','PERMISO',
                    'ARREGLOS','MUESTRAS','REPROCESOS','DESCOSER','OTROS') then
    return json_build_object('ok', false, 'error', 'Tipo inválido'); end if;
  if not exists (select 1 from operarios where dni = p_dni_op) then
    return json_build_object('ok', false, 'error', 'No existe ese DNI'); end if;

  select coalesce(p_fecha, fecha), dni, area into v_fecha, v_dni_ant, v_area_ant
    from ocurrencias where id = p_id;
  if v_fecha is null then return json_build_object('ok', false, 'error', 'No existe esa incidencia'); end if;
  perform _vista_area(s, array[v_area_ant], true);
  v_est := _ausente_en(p_dni_op, v_fecha);
  if v_est is not null then
    return json_build_object('ok', false, 'error',
      'El '||to_char(v_fecha,'YYYY-MM-DD')||' esa persona está como '||v_est
      ||': no puede tener incidencias ese día.');
  end if;

  -- El área solo se recalcula si la incidencia cambia de PERSONA. Editar
  -- minutos, fecha, tipo o detalle deja la incidencia en su área original.
  if p_dni_op is distinct from v_dni_ant then
    select area_actual into v_area from operarios where dni = p_dni_op;
    perform _vista_area(s, array[v_area], true);
  else
    v_area := null;
  end if;

  update ocurrencias
     set dni = p_dni_op, area = coalesce(v_area, area), tipo = p_tipo,
         minutos = p_minutos, fecha = v_fecha,
         detalle = nullif(trim(p_detalle),'')
   where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'No existe esa incidencia'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_ocurrencia_eliminar(p_dni text, p_token uuid, p_id bigint)
 returns json
 language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; v_area text;
begin
  s := _vista(p_dni, p_token, array['pasoIncid','pasoAudit'], null);
  select area into v_area from ocurrencias where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'No existe esa incidencia'); end if;
  perform _vista_area(s, array[v_area], true);
  delete from ocurrencias where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'No existe esa incidencia'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- 5. Verificación ----------
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosrc ~ '_admin\(' and p.proname not in
     ('fn_permisos_listar','fn_permisos_guardar','fn_correcciones_listar','_vista','_vista_area');
  if n > 0 then raise exception 'Parche 101: quedan % RPC con _admin', n; end if;
end $$;

commit;
