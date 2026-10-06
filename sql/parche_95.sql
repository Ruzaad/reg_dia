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
begin;

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

insert into permisos_area (dni, area, nivel, asignado_por) values
  ('LFABIAN', 'CAMISA COSTURA',   'EDITAR', 'PARCHE 95'),
  ('KROJAS',  'SACO COSTURA',     'EDITAR', 'PARCHE 95'),
  ('KROJAS',  'PANTALON COSTURA', 'EDITAR', 'PARCHE 95')
on conflict (dni, area) do update set nivel = excluded.nivel;

insert into permisos_pestana (dni, pestana, asignado_por)
select o.dni, t, 'PARCHE 95'
  from operarios o,
       unnest(array['pasoTk','pasoMod','pasoGen','pasoOfs','pasoAvOF','pasoVista','pasoEf',
                    'pasoDash','pasoAsis','pasoBases','pasoIncid','pasoFechas',
                    'pasoSupArea','pasoOpArea']) t
 where o.cargo = 'INGENIERIA' and not coalesce(o.es_admin, false)
on conflict (dni, pestana) do nothing;

commit;

-- Verificación (opcional):
-- select * from permisos_area order by dni, area;
-- select tgrelid::regclass, tgname from pg_trigger where tgname = 'perm_area_trg';
-- select count(*) from parche95_respaldo;   -- 36
