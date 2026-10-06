-- =====================================================================
-- SQL MAESTRO · parches 95, 96 y 97 (6 oct 2026)
--
-- Cómo correrlo: Supabase › SQL Editor › New query › pegar TODO › Run.
-- Corre en UNA sola transacción: si algo falla, no queda nada a medias
-- (la base sigue igual que antes y el error dice en qué paso se cortó).
-- Es re-ejecutable: si se corre dos veces no duplica nada.
--
-- Orden:
--   PASO 1 · Parche 95  Permisos por área y pestaña (lo reparte ALOPEZ).
--   PASO 2 · Parche 96  Pantalla de Costos (necesita el 95).
--   PASO 3 · Parche 97  Estados de asistencia "EN <área>".
-- El parche 94 (hoja de numeración) ya está aplicado desde el 5 oct: no va.
--
-- Ajustes respecto a los archivos sueltos del repositorio:
--   · En el 97, fn_asistencia_areas y fn_asistencia_dashboard validan con
--     _lector (como las deja el 95). El 97 suelto usaba _ing y habría
--     deshecho el permiso por área en esas dos funciones.
--   · En el 95, los permisos de arranque de LFABIAN y KROJAS solo se
--     insertan si el usuario existe (así un DNI ausente no tumba todo).
--
-- Al terminar muestra un resumen. Debe decir: 36 funciones con _lector,
-- 15 triggers de permiso, 4 funciones de Costos y 9 estados "EN".
-- Vuelta atrás (en este orden): sql/parche_97_rollback.sql,
-- sql/parche_96_rollback.sql, sql/parche_95_rollback.sql.
-- =====================================================================
begin;


-- #####################################################################
-- PASO 1 · PARCHE 95 — Permisos por área y pestaña
-- #####################################################################
-- PARCHE 95 — Permisos por área y pestaña, decididos por el administrador maestro
--
-- Cada usuario que no es operario, estajero ni supervisora tiene:
--   · permisos_area:    por área, LEER o EDITAR ('*' = todas las áreas).
--   · permisos_pestana: las pestañas de ingenieria.html que puede abrir.
-- El administrador maestro (operarios.es_admin, hoy ALOPEZ) ve y edita todo y
-- es quien reparte esos permisos desde la pestaña Permisos.
--
-- Escribir: un trigger por tabla revisa el área de cada fila que se toca. No se
-- reescriben las RPC de escritura; basta con que _auth deje en la transacción
-- las áreas que el usuario puede editar.
-- Leer: las RPC de lectura de Ingeniería validan con _lector (por área) en vez
-- de exigir cargo INGENIERIA, así otro cargo (por ejemplo Costos) puede leer lo
-- que el administrador le dé.
--
-- Re-ejecutable. Vuelta atrás: sql/parche_95_rollback.sql.
-- ---------- 1. Tablas ----------
create table if not exists public.permisos_area (
  dni          text not null references public.operarios(dni) on update cascade on delete cascade,
  area         text not null,
  nivel        text not null check (nivel in ('LEER','EDITAR')),
  asignado_por text,
  creado       timestamptz not null default now(),
  primary key (dni, area)
);
create table if not exists public.permisos_pestana (
  dni          text not null references public.operarios(dni) on update cascade on delete cascade,
  pestana      text not null,
  asignado_por text,
  creado       timestamptz not null default now(),
  primary key (dni, pestana)
);
alter table public.permisos_area    enable row level security;
alter table public.permisos_pestana enable row level security;
revoke all on public.permisos_area, public.permisos_pestana from anon, authenticated;

-- ---------- 2. Permisos en la transacción ----------
-- app.perm = '*' si no hay restricción; '|AREA1|AREA2|' con las áreas que puede
-- editar si la hay ('||' = ninguna). app.dni = quién llama (ya lo usaba bases_log).
create or replace function public._perm_set(o operarios)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v text;
begin
  perform set_config('app.dni', o.dni, true);
  if coalesce(o.es_admin, false) or o.cargo in ('OPERARIO','ESTAJERO','SUPERVISORA') then
    perform set_config('app.perm', '*', true);
    return;
  end if;
  select '|' || coalesce(string_agg(area, '|'), '') || '|' into v
    from permisos_area where dni = o.dni and nivel = 'EDITAR';
  if position('|*|' in v) > 0 then v := '*'; end if;
  perform set_config('app.perm', v, true);
end $function$;
revoke execute on function public._perm_set(operarios) from public, anon, authenticated;

create or replace function public._auth(p_dni text, p_token uuid)
 returns operarios language plpgsql security definer set search_path to 'public'
as $function$
declare
  o operarios;
  v_idle  interval := interval '4 hours';
  v_max   interval := interval '18 hours';
  v_nuevo timestamptz;
begin
  select * into o from operarios
   where dni = p_dni and token = p_token
     and token_expira > now() and estado = 'ACTIVO';
  if not found then raise exception 'SESION_INVALIDA'; end if;

  if not fn_horario_ok() then raise exception 'FUERA_DE_HORARIO'; end if;

  v_nuevo := least(now() + v_idle, coalesce(o.token_creado, now()) + v_max);
  if o.token_expira < now() + (v_idle / 2) and v_nuevo > o.token_expira then
    update operarios set token_expira = v_nuevo where dni = o.dni;
    o.token_expira := v_nuevo;
  end if;

  perform _perm_set(o);
  return o;
end $function$;
revoke execute on function public._auth(text, uuid) from public, anon, authenticated;

create or replace function public.fn_validar_ingenieria(p_dni text, p_token text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v operarios%rowtype;
begin
  select * into v from operarios where dni = p_dni;
  if not found or v.token::text is distinct from p_token or v.token_expira < now() then
    raise exception 'SESION_INVALIDA';
  end if;
  if v.cargo <> 'INGENIERIA' then
    raise exception 'NO_AUTORIZADA';
  end if;
  perform _perm_set(v);
end;
$function$;

-- ---------- 3. Lectura por área ----------
-- p_area vacío = todas las áreas: exige permiso en '*'.
create or replace function public._lector(p_dni text, p_token uuid, p_area text default '')
 returns operarios language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; a text := nullif(trim(coalesce(p_area, '')), '');
begin
  o := _auth(p_dni, p_token);
  if coalesce(o.es_admin, false) then return o; end if;
  if o.cargo in ('OPERARIO','ESTAJERO','SUPERVISORA') then raise exception 'NO_AUTORIZADA'; end if;
  if not exists (select 1 from permisos_area where dni = o.dni and (area = '*' or area = a)) then
    raise exception 'NO_AUTORIZADA_AREA: sin acceso a %', coalesce(a, 'todas las áreas');
  end if;
  return o;
end $function$;
revoke execute on function public._lector(text, uuid, text) from public, anon, authenticated;

-- ---------- 4. Escritura por área: trigger ----------
-- Argumentos: columnas con el área de la fila (basta que una esté permitida),
-- o '@dni' para leer el área de origen/actual del operario de la fila.
create or replace function public._perm_area_trg()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  p text := current_setting('app.perm', true);
  r jsonb; c text; a text; areas text[]; ok boolean;
begin
  foreach r in array array[
      case when tg_op <> 'INSERT' then to_jsonb(old) end,
      case when tg_op <> 'DELETE' then to_jsonb(new) end]::jsonb[] loop
    continue when r is null;
    -- Cada quien puede tocar su propia fila (renovar sesión, cambiar su PIN).
    if tg_table_name = 'operarios' and r->>'dni' = current_setting('app.dni', true) then continue; end if;
    if tg_argv[0] = '@dni' then
      select array[o.area_origen, o.area_actual] into areas from operarios o where o.dni = r->>'dni';
    else
      areas := array[]::text[];
      foreach c in array tg_argv loop areas := areas || (r->>c); end loop;
    end if;
    select array_agg(distinct x) into areas from unnest(areas) x where x is not null;
    continue when coalesce(array_length(areas, 1), 0) = 0;
    ok := false;
    foreach a in array areas loop
      if position('|' || a || '|' in p) > 0 then ok := true; exit; end if;
    end loop;
    if not ok then
      raise exception 'NO_AUTORIZADA_AREA: solo lectura en %', array_to_string(areas, ' / ');
    end if;
  end loop;
  return null;
end $function$;
revoke execute on function public._perm_area_trg() from public, anon, authenticated;

do $$
declare t record;
begin
  for t in select * from (values
      ('bases',              'area'),
      ('reclamos',           'area'),
      ('ocurrencias',        'area'),
      ('solicitudes_ajuste', 'area'),
      ('of_generada',        'area'),
      ('of_troceo',          'area'),
      ('operaciones_extra',  'area'),
      ('ops_adicionales_of', 'area'),
      ('modulos_cerrados',   'area'),
      ('residuales',         'area'),
      ('area_hora_declarada','area'),
      ('areas_config',       'area'),
      ('movimientos_area',   'area_anterior'', ''area_nueva'),
      ('operarios',          'area_origen'', ''area_actual'),
      ('asistencia',         '@dni')
    ) v(tabla, args)
  loop
    execute format('drop trigger if exists perm_area_trg on public.%I', t.tabla);
    -- WHEN: sin restricción (operarios, supervisoras, admin, sistema) ni se llama.
    execute format($f$create trigger perm_area_trg after insert or update or delete on public.%I
      for each row when (current_setting('app.perm', true) like '|%%')
      execute function public._perm_area_trg('%s')$f$, t.tabla, t.args);
  end loop;
end $$;

-- ---------- 5. Las RPC de lectura de Ingeniería pasan a _lector ----------
-- Se guarda la definición viva antes de cambiarla: el rollback la restaura tal cual.
create table if not exists public.parche95_respaldo (
  oid_txt text primary key, proname text, def text, creado timestamptz default now());
alter table public.parche95_respaldo enable row level security;
revoke all on public.parche95_respaldo from anon, authenticated;

do $$
declare r record; d text; d2 text; arg text; n int := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) def,
           'p_area' = any(p.proargnames) tiene_area
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prokind = 'f' and p.proname in (
       'fn_asistencia_areas','fn_asistencia_dashboard','fn_asistencia_matriz','fn_avance_modulos',
       'fn_base_almacen_map','fn_base_sync','fn_base_valores','fn_bases_existentes','fn_bases_listar',
       'fn_bases_operaciones','fn_cantidad_areas','fn_eficiencia_areas','fn_eficiencia_dia',
       'fn_eficiencia_rango','fn_he_lote_personal','fn_minutos_modulos','fn_mod_avance',
       'fn_motivos_fecha_listar','fn_ocurrencias_listar','fn_of_metas','fn_of_ruta',
       'fn_of_trazabilidad','fn_ofs_generables','fn_ofs_listar','fn_origen_reclamos',
       'fn_personal_detalle','fn_personal_listar','fn_personal_meta','fn_prendas_articulo',
       'fn_reclamos_operario','fn_reclamos_por_of','fn_resumen_operario','fn_tickets_dia',
       'fn_tickets_libres','fn_tickets_rango','fn_tickets_visibilidad_listar')
  loop
    d := r.def;
    if position('_lector(' in d) > 0 then continue; end if;
    insert into parche95_respaldo (oid_txt, proname, def) values (r.oid::text, r.proname, d)
      on conflict (oid_txt) do nothing;
    arg := case when r.tiene_area then 'p_area' else '''''' end;
    d2 := regexp_replace(d, 'perform _ing\(p_dni, p_token\);',
                         'perform _lector(p_dni, p_token, ' || arg || ');');
    d2 := regexp_replace(d2, 'perform fn_validar_ingenieria\((p_dni(_ing)?), p_token\);',
                         'perform _lector(\1, p_token::uuid, ' || arg || ');');
    if d2 = d then raise exception 'PARCHE 95: % no tiene la validación esperada', r.proname; end if;
    execute d2;
    n := n + 1;
  end loop;
  raise notice 'PARCHE 95: % funciones de lectura pasan a _lector', n;
end $$;

-- ---------- 6. RPC de permisos ----------
create or replace function public.fn_mis_permisos(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return json_build_object(
    'admin', coalesce(o.es_admin, false),
    'areas', coalesce((select json_object_agg(area, nivel) from permisos_area where dni = o.dni), '{}'::json),
    'pestanas', coalesce((select json_agg(pestana order by pestana) from permisos_pestana where dni = o.dni), '[]'::json));
end $function$;

create or replace function public.fn_permisos_listar(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
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

-- p_areas: {"CAMISA COSTURA":"EDITAR","*":"LEER"}. Reemplaza lo que tenía.
create or replace function public.fn_permisos_guardar(
  p_dni text, p_token uuid, p_usuario text, p_areas jsonb, p_pestanas text[])
 returns json language plpgsql security definer set search_path to 'public'
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
  insert into permisos_area (dni, area, nivel, asignado_por)
  select u.dni, e.key, e.value, o.dni
    from jsonb_each_text(coalesce(p_areas, '{}'::jsonb)) e
   where e.value in ('LEER','EDITAR') and trim(e.key) <> '';
  delete from permisos_pestana where dni = u.dni;
  insert into permisos_pestana (dni, pestana, asignado_por)
  select distinct u.dni, x, o.dni from unnest(coalesce(p_pestanas, '{}')) x where trim(x) <> '';
  return json_build_object('ok', true);
end $function$;

grant execute on function public.fn_mis_permisos(text, uuid) to anon, authenticated;
grant execute on function public.fn_permisos_listar(text, uuid) to anon, authenticated;
grant execute on function public.fn_permisos_guardar(text, uuid, text, jsonb, text[]) to anon, authenticated;

-- ---------- 7. Permisos de arranque ----------
-- Todo Ingeniería sigue leyendo todo y abriendo las mismas pestañas que hoy.
-- Edición: LFABIAN en CAMISA COSTURA; KROJAS en SACO y PANTALON COSTURA.
-- El resto de áreas (ACABADO, CORTE, REPROCESO, UDP...) solo las edita el
-- administrador hasta que él las reparta.
insert into permisos_area (dni, area, nivel, asignado_por)
select dni, '*', 'LEER', 'PARCHE 95' from operarios where cargo = 'INGENIERIA' and not coalesce(es_admin, false)
on conflict (dni, area) do nothing;

insert into permisos_area (dni, area, nivel, asignado_por)
select v.dni, v.area, 'EDITAR', 'PARCHE 95'
  from (values ('LFABIAN', 'CAMISA COSTURA'),
               ('KROJAS',  'SACO COSTURA'),
               ('KROJAS',  'PANTALON COSTURA')) v(dni, area)
 where exists (select 1 from operarios o where o.dni = v.dni)
on conflict (dni, area) do update set nivel = excluded.nivel;

insert into permisos_pestana (dni, pestana, asignado_por)
select o.dni, t, 'PARCHE 95'
  from operarios o,
       unnest(array['pasoTk','pasoMod','pasoGen','pasoOfs','pasoAvOF','pasoVista','pasoEf',
                    'pasoDash','pasoAsis','pasoBases','pasoIncid','pasoFechas',
                    'pasoSupArea','pasoOpArea']) t
 where o.cargo = 'INGENIERIA' and not coalesce(o.es_admin, false)
on conflict (dni, pestana) do nothing;

-- Verificación (opcional):
-- select * from permisos_area order by dni, area;
-- select tgrelid::regclass, tgname from pg_trigger where tgname = 'perm_area_trg';
-- select count(*) from parche95_respaldo;   -- 36

-- #####################################################################
-- PASO 2 · PARCHE 96 — Pantalla de Costos (solo lectura)
-- #####################################################################
-- =====================================================================
-- PARCHE 96 — Pantalla de Costos (solo lectura)
-- Cuatro RPC de lectura para las pestañas de Costos de ingenieria.html:
-- Base (balance de línea), Reporte de hoy, Incidencias y Asistencia.
-- No escriben nada. Validan con _lector (parche 95): pasa el admin o quien
-- tenga LEER/EDITAR en el área pedida; área vacía = todas (permiso '*').
-- Requiere el parche 95 aplicado antes.
-- =====================================================================
do $$ begin
  if to_regprocedure('public._lector(text,uuid,text)') is null then
    raise exception 'Falta _lector: aplica primero el parche 95 (permisos por área)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) BASE de un área: lo mismo que fn_bases_listar, sin datos de auditoría.
-- ---------------------------------------------------------------------
create or replace function public.fn_costos_base(p_dni text, p_token uuid, p_area text)
returns json language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(p_area,'') = '' then raise exception 'Indica el área'; end if;
  perform _lector(p_dni, p_token, p_area);
  return coalesce((select json_agg(json_build_object(
      'prenda', prenda, 'cliente', cliente, 'modulo', modulo, 'articulo', articulo,
      'operacion', operacion, 'std', std, 'max_op', max_op, 'n_op', n_op)
      order by articulo, n_op)
    from bases where area = p_area), '[]'::json);
end $$;

-- ---------------------------------------------------------------------
-- 2) REPORTE DE HOY: tickets ACTIVOS del día sumados por área, artículo,
--    OF, operación y N°OP; la última y penúltima operación (N°OP) de cada
--    artículo según su BASE, y las incidencias del día. La elección
--    última/penúltima se hace en el cliente sin volver a pedir datos.
-- ---------------------------------------------------------------------
create or replace function public.fn_costos_reporte(p_dni text, p_token uuid, p_fecha date, p_area text default '')
returns json language plpgsql security definer set search_path = public
as $$
declare v_tk json; v_ult json; v_inc json;
begin
  perform _lector(p_dni, p_token, coalesce(p_area,''));
  if p_fecha is null then raise exception 'Indica la fecha'; end if;

  with t as (
    select r.area, upper(trim(r.articulo)) art, r.o_f, r.op, r.nop,
           sum(r.cant) cant, count(*) tks
      from reclamos r
     where r.fecha = p_fecha and r.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or r.area = p_area)
     group by 1,2,3,4,5
  )
  select coalesce(json_agg(json_build_object('area', area, 'articulo', art, 'of', o_f,
           'op', op, 'nop', nop, 'cant', cant, 'tks', tks)), '[]'::json)
    into v_tk from t;

  with arts as (
    select distinct r.area, upper(trim(r.articulo)) art
      from reclamos r
     where r.fecha = p_fecha and r.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or r.area = p_area)
  ), b as (
    select distinct b.area, a.art, b.n_op
      from bases b join arts a on a.area = b.area and upper(trim(b.articulo)) = a.art
     where b.n_op > 0
  ), k as (
    select area, art, n_op, dense_rank() over (partition by area, art order by n_op desc) k from b
  )
  select coalesce(json_agg(json_build_object('area', area, 'articulo', art, 'n1', n1, 'n2', n2)), '[]'::json)
    into v_ult
    from (select area, art, max(n_op) filter (where k = 1) n1, max(n_op) filter (where k = 2) n2
            from k group by area, art) z;

  select coalesce(json_agg(json_build_object(
      'nombre', o.nombres_apellidos, 'area', oc.area, 'tipo', oc.tipo,
      'minutos', oc.minutos, 'detalle', oc.detalle,
      'hora', to_char(oc.creado at time zone 'America/Lima','HH24:MI'))
      order by oc.creado desc), '[]'::json)
    into v_inc
    from ocurrencias oc join operarios o on o.dni = oc.dni
   where oc.fecha = p_fecha and (coalesce(p_area,'') = '' or oc.area = p_area);

  return json_build_object('ok', true, 'fecha', to_char(p_fecha,'YYYY-MM-DD'),
    'tickets', v_tk, 'ultimas', v_ult, 'incidencias', v_inc);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------------------------------------------------------------------
-- 3) INCIDENCIAS de un rango (máx. 93 días).
-- ---------------------------------------------------------------------
create or replace function public.fn_costos_incidencias(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
returns json language plpgsql security definer set search_path = public
as $$
begin
  perform _lector(p_dni, p_token, coalesce(p_area,''));
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    return json_build_object('ok', false, 'error', 'Rango de fechas inválido');
  end if;
  if p_hasta - p_desde > 93 then
    return json_build_object('ok', false, 'error', 'El rango máximo es de 3 meses');
  end if;
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object(
      'fecha', to_char(oc.fecha,'YYYY-MM-DD'),
      'hora', to_char(oc.creado at time zone 'America/Lima','HH24:MI'),
      'nombre', o.nombres_apellidos, 'area', oc.area, 'tipo', oc.tipo,
      'minutos', oc.minutos, 'detalle', oc.detalle,
      'registrado_por', coalesce(sup.nombres_apellidos, oc.supervisora_dni))
      order by oc.fecha desc, oc.creado desc)
    from ocurrencias oc
    join operarios o on o.dni = oc.dni
    left join operarios sup on sup.dni = oc.supervisora_dni
    where (coalesce(p_area,'') = '' or oc.area = p_area)
      and oc.fecha between p_desde and p_hasta), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------------------------------------------------------------------
-- 4) ASISTENCIA del día: el personal (operarios activos por área de
--    origen) con su estado efectivo. Igual que la lista de marcar: con al
--    menos un ticket del día cuenta como ACTIVO aunque tenga otra marca;
--    sin marca ni tickets queda en null (sin marcar).
-- ---------------------------------------------------------------------
create or replace function public.fn_costos_asistencia(p_dni text, p_token uuid, p_area text, p_fecha date)
returns json language plpgsql security definer set search_path = public
as $$
declare v_fecha date := coalesce(p_fecha, _hoy()); v json;
begin
  perform _lector(p_dni, p_token, coalesce(p_area,''));
  select coalesce(json_agg(json_build_object(
      'nombre', z.nombre, 'area', z.area_origen, 'area_actual', z.area_actual,
      'estado', case when z.tickets > 0 then 'ACTIVO' else z.estado end,
      'estado_guardado', z.estado, 'tickets', z.tickets)
      order by z.area_origen, z.nombre), '[]'::json)
    into v
  from (
    select o.nombres_apellidos nombre, o.area_origen, o.area_actual,
           (select a.estado from asistencia a
             where a.dni = o.dni and a.fecha = v_fecha
             order by a.creado desc limit 1) estado,
           (select count(*) from reclamos r
             where r.dni = o.dni and r.fecha = v_fecha and r.estado = 'ACTIVO') tickets
      from operarios o
     where o.cargo = 'OPERARIO' and o.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or o.area_origen = p_area)
  ) z;
  return json_build_object('ok', true, 'fecha', to_char(v_fecha,'YYYY-MM-DD'), 'personal', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- Solo se llaman desde la app (anon), como el resto de RPC con token.
revoke all on function public.fn_costos_base(text, uuid, text) from public;
revoke all on function public.fn_costos_reporte(text, uuid, date, text) from public;
revoke all on function public.fn_costos_incidencias(text, uuid, text, date, date) from public;
revoke all on function public.fn_costos_asistencia(text, uuid, text, date) from public;
grant execute on function public.fn_costos_base(text, uuid, text) to anon, authenticated;
grant execute on function public.fn_costos_reporte(text, uuid, date, text) to anon, authenticated;
grant execute on function public.fn_costos_incidencias(text, uuid, text, date, date) to anon, authenticated;
grant execute on function public.fn_costos_asistencia(text, uuid, text, date) to anon, authenticated;

-- #####################################################################
-- PASO 3 · PARCHE 97 — Asistencia: estados "EN <área>"
-- #####################################################################
-- PARCHE 97 · Asistencia: variables "EN <área>" (personal presente apoyando en otra área)
-- Ver parches/PARCHE_97.md. Idempotente: se puede correr más de una vez.

-- 1) Los nueve estados nuevos. Todos empiezan con "EN ": así los reconoce la app.
insert into estados_asistencia (nombre) values
  ('EN ACABADO'), ('EN SASTRERIA (UDP)'), ('EN CAMISAS'), ('EN SACOS'), ('EN PANTALON'),
  ('EN REPROCESO'), ('EN DESPACHO'), ('EN ALMACEN'), ('EN CORTE')
on conflict (nombre) do nothing;

-- 2) ¿Estuvo en planta? ACTIVO o en otra área. `_ausente` NO cambia: para la
--    eficiencia de su área de origen, quien está en otra área no tiene minutos
--    exigidos (igual que hoy con una incidencia de 575 min por Despacho).
create or replace function public._presente(p_estado text)
returns boolean language sql immutable
as $$ select coalesce(p_estado,'ACTIVO') = 'ACTIVO' or p_estado like 'EN %' $$;

-- 3) % de asistencia por área: "EN <área>" cuenta como asistió, no como excusado.
create or replace function public.fn_asistencia_areas(p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v json;
begin
  perform _lector(p_dni, p_token, '');   -- parche 95: lectura por área
  if p_hasta < p_desde then return json_build_object('ok',false,'error','Rango inválido'); end if;
  if (p_hasta - p_desde) > 366 then return json_build_object('ok',false,'error','Rango máximo 366 días'); end if;

  with areas as (
    select area_actual area, count(*) estructura
    from operarios where cargo='OPERARIO' and estado='ACTIVO'
    group by area_actual
  ),
  dias as (
    select d::date f from generate_series(p_desde,p_hasta,interval '1 day') d
    where extract(dow from d) not in (0,6)
  ),
  est as (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
        row_number() over (partition by a.dni,a.fecha order by a.creado desc) rn
      from asistencia a where a.fecha between p_desde and p_hasta
    ) z where rn=1
  ),
  cont as (
    select o.area_actual area, dd.f,
      count(*) filter (where e.estado is not null and _presente(e.estado)) activos,
      count(*) filter (where e.estado is not null and not _presente(e.estado) and e.estado <> 'FALTA') excus
    from operarios o
    cross join dias dd
    left join est e on e.dni=o.dni and e.fecha=dd.f
    where o.cargo='OPERARIO' and o.estado='ACTIVO'
    group by o.area_actual, dd.f
  ),
  pct as (
    select c.area, avg( case when (a.estructura - c.excus) > 0
                             then c.activos::numeric/(a.estructura - c.excus)*100 end ) p
    from cont c join areas a on a.area=c.area
    group by c.area
  )
  select coalesce(json_agg(json_build_object(
      'area', a.area, 'estructura', a.estructura,
      'pct', round(coalesce(p.p,0),1)) order by a.area), '[]'::json)
    into v
  from areas a left join pct p on p.area=a.area;

  return json_build_object('ok', true, 'areas', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- 4) Tablero de asistencia: "EN <área>" suma a presentes, no sale en alertas y
--    se cuenta aparte (hoy_otra_area, clave nueva: el front viejo la ignora).
create or replace function public.fn_asistencia_dashboard(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
  v_personal int; v_lab int; v_hoy_pres int := 0; v_hoy_otra int := 0;
  v_pordia json; v_porestado json; v_alertas json; v_detalle json;
  hoy date := _hoy();
begin
  perform _lector(p_dni, p_token, p_area);   -- parche 95: lectura por área
  if p_hasta < p_desde then return json_build_object('ok',false,'error','Rango inválido'); end if;
  if (p_hasta - p_desde) > 366 then return json_build_object('ok',false,'error','Rango máximo 366 días'); end if;

  select count(*) into v_personal from operarios o
   where o.cargo='OPERARIO' and o.estado='ACTIVO' and (coalesce(p_area,'')='' or o.area_actual=p_area);
  select count(*) into v_lab from generate_series(p_desde,p_hasta,interval '1 day') d
   where extract(dow from d) not in (0,6);

  with gente as (
    select dni from operarios where cargo='OPERARIO' and estado='ACTIVO'
      and (coalesce(p_area,'')='' or area_actual=p_area)
  ),
  dias as (
    select d::date f from generate_series(p_desde,p_hasta,interval '1 day') d
    where extract(dow from d) not in (0,6)
  ),
  est as (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
        row_number() over (partition by a.dni,a.fecha order by a.creado desc) rn
      from asistencia a
      where a.fecha between p_desde and p_hasta and a.dni in (select dni from gente)
    ) z where rn=1 and not _presente(estado)
  ),
  aus as (
    select dd.f, count(distinct e.dni) n
    from dias dd left join est e on e.fecha = dd.f
    group by dd.f
  )
  select coalesce(json_agg(json_build_object(
      'fecha', to_char(f,'YYYY-MM-DD'),
      'presentes', greatest(v_personal - n, 0),
      'ausentes', n) order by f), '[]'::json)
    into v_pordia from aus;

  with gente as (
    select dni from operarios where cargo='OPERARIO' and estado='ACTIVO'
      and (coalesce(p_area,'')='' or area_actual=p_area)
  ),
  dias as (
    select d::date f from generate_series(p_desde,p_hasta,interval '1 day') d
    where extract(dow from d) not in (0,6)
  ),
  est as (
    select z.dni, z.estado from (
      select a.dni, a.fecha, a.estado,
        row_number() over (partition by a.dni,a.fecha order by a.creado desc) rn
      from asistencia a
      where a.fecha between p_desde and p_hasta and a.dni in (select dni from gente)
    ) z join dias dd on dd.f = z.fecha where z.rn=1 and z.estado <> 'ACTIVO'
  ),
  peor as ( select dni, estado, count(*) c from est group by dni, estado ),
  pres as ( select g.dni, greatest(v_lab - coalesce((select sum(c) from peor p where p.dni=g.dni),0),0) c from gente g ),
  allrows as (
    select o.nombres_apellidos nombre, p.estado, p.c from peor p join operarios o on o.dni=p.dni
    union all
    select o.nombres_apellidos nombre, 'ACTIVO' estado, pr.c from pres pr join operarios o on o.dni=pr.dni where pr.c>0
  )
  select coalesce((select json_object_agg(estado, arr) from (
           select estado, json_agg(json_build_object('nombre',nombre,'veces',c) order by c desc, nombre) arr
           from allrows group by estado) u), '{}'::json),
         coalesce((select json_object_agg(estado, tot) from (
           select estado, sum(c) tot from allrows group by estado) v), '{}'::json)
    into v_detalle, v_porestado;

  if extract(dow from hoy) not in (0,6) then
    select v_personal - count(distinct z.dni) filter (where not _presente(z.estado)),
           count(distinct z.dni) filter (where z.estado like 'EN %')
      into v_hoy_pres, v_hoy_otra
    from (
      select a.dni, a.estado, row_number() over (partition by a.dni order by a.creado desc) rn
      from asistencia a
      where a.fecha = hoy and a.estado <> 'ACTIVO'
        and a.dni in (select dni from operarios where cargo='OPERARIO' and estado='ACTIVO'
                      and (coalesce(p_area,'')='' or area_actual=p_area))
    ) z where z.rn=1;
  else v_hoy_pres := 0; end if;

  select coalesce(json_agg(json_build_object(
      'fecha', to_char(e.fecha,'YYYY-MM-DD'), 'nombre', o.nombres_apellidos, 'estado', e.estado)
      order by e.fecha desc, o.nombres_apellidos), '[]'::json)
    into v_alertas
  from (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
        row_number() over (partition by a.dni,a.fecha order by a.creado desc) rn
      from asistencia a
      where a.fecha between greatest(p_desde, p_hasta - 6) and p_hasta
        and a.dni in (select dni from operarios where cargo='OPERARIO' and estado='ACTIVO'
                      and (coalesce(p_area,'')='' or area_actual=p_area))
    ) z where rn=1 and not _presente(estado)
  ) e join operarios o on o.dni = e.dni;

  return json_build_object('ok', true,
    'personal', v_personal, 'dias_laborales', v_lab,
    'hoy_presentes', greatest(v_hoy_pres,0), 'hoy_total', v_personal,
    'hoy_otra_area', coalesce(v_hoy_otra,0),
    'por_dia', v_pordia, 'por_estado', coalesce(v_porestado,'{}'::json),
    'detalle', coalesce(v_detalle,'{}'::json), 'alertas', v_alertas);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Verificación (debe dar 15 estados, 9 que empiezan con "EN "):
-- select count(*), count(*) filter (where nombre like 'EN %') from estados_asistencia;

-- #####################################################################
-- RESUMEN
-- #####################################################################
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and position('_lector(' in pg_get_functiondef(p.oid)) > 0
      and p.proname not in ('_lector','fn_costos_base','fn_costos_reporte','fn_costos_incidencias','fn_costos_asistencia'))
                                                                        as funciones_con_lector,      -- 36
  (select count(*) from pg_trigger where tgname = 'perm_area_trg')      as triggers_permiso,          -- 15
  (select count(*) from pg_proc where proname like 'fn_costos_%')       as funciones_costos,          -- 4
  (select count(*) from estados_asistencia where nombre like 'EN %')    as estados_en_area,           -- 9
  (select count(*) from permisos_area)                                  as permisos_area_filas,
  (select count(*) from permisos_pestana)                               as permisos_pestana_filas;

commit;
