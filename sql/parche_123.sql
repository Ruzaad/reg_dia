-- PARCHE 123 — Bases de REPROCESO (y DESPACHO) y lote = base × cantidad
-- Hasta hoy cada tarea de lotes tenía UN tiempo para todo el área: DESARMAR
-- CAMISA valía igual para cualquier prenda. Ahora Ingeniería arma BASES por
-- área (nombre = prenda, artículo o cliente) con sus operaciones en orden y el
-- tiempo de cada una (min por prenda), igual que la BASE de ACABADO.
-- Al crear un lote se elige la base y la cantidad máxima: se crea un lote por
-- operación de la base (L-1, L-2…), todos con la misma cantidad como tope y el
-- tiempo de la base. Como en ACABADO, el tiempo se toma al registrar (queda
-- congelado en el minutaje) y la cantidad del lote es el tope.
-- Los lotes sin base siguen como antes (tiempo por tarea). CORTE no se toca.
-- Arranque: si no hay bases, crea la base CAMISA de REPROCESO con las tareas
-- con tiempo que ya subió Ingeniería (en el orden en que se subieron) y le
-- engancha los lotes abiertos de REPROCESO con esas operaciones (9CY740).
-- Los tiempos son los mismos, así que el minutaje no cambia.
-- Rollback: parche_123_rollback.sql
begin;

-- ---------- Tablas ----------
create table if not exists public.lote_bases (
  id              serial primary key,
  area            text not null check (area in ('DESPACHO','REPROCESO')),
  nombre          text not null,
  activo          boolean not null default true,
  creado          timestamptz not null default now(),
  creado_por      text not null,
  actualizado     timestamptz,
  actualizado_por text,
  unique (area, nombre)
);
create table if not exists public.lote_base_ops (
  id         serial primary key,
  base_id    integer not null references public.lote_bases(id),
  n_op       integer not null,
  operacion  text not null,
  std        numeric not null check (std > 0 and std <= 600),
  activo     boolean not null default true
);
create index if not exists lote_base_ops_base on public.lote_base_ops (base_id, n_op);
alter table public.lotes add column if not exists base_op_id integer references public.lote_base_ops(id);
alter table public.lote_bases enable row level security;
alter table public.lote_base_ops enable row level security;
revoke all on public.lote_bases, public.lote_base_ops from anon, authenticated;

-- Tiempo de un lote: el de su operación en la base; sin base, el de la tarea.
create or replace function public._lote_std(l lotes)
 returns numeric language sql stable security definer set search_path to 'public' as $$
  select case when l.base_op_id is not null
    then (select b.std from lote_base_ops b where b.id = l.base_op_id)
    else (select k.std from lote_tareas k where k.area = l.area and k.nombre = l.tarea) end
$$;
revoke all on function public._lote_std(lotes) from public, anon, authenticated;

-- Igual que el 119, pero el tiempo sale de _lote_std.
create or replace function public._lote_minutaje(p_tramo bigint)
 returns numeric language plpgsql security definer set search_path to 'public' as $function$
declare t lote_tramos; l lotes; v_std numeric; v_cargo text; v_rid bigint; v_perm text; v_min numeric;
begin
  select * into t from lote_tramos where id = p_tramo;
  if t.id is null then return null; end if;
  select * into l from lotes where id = t.lote_id;
  v_std := _lote_std(l);
  select cargo into v_cargo from operarios where dni = t.dni;
  select id into v_rid from reclamos where lote_tramo_id = t.id;
  v_perm := current_setting('app.perm', true);
  perform set_config('app.perm', '*', true);
  if t.fin is null or coalesce(t.prendas, 0) = 0 then
    if v_rid is not null then delete from reclamos where id = v_rid; end if;
  elsif v_rid is not null then
    update reclamos set cant = t.prendas, fecha = (t.inicio at time zone 'America/Lima')::date where id = v_rid;
  elsif v_std is not null and v_cargo in ('OPERARIO','ESTAJERO') then
    insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant, fecha, lote_tramo_id)
    values (null, t.dni, l.area, l.o_f, 'L-' || l.id, l.tarea, v_std, t.prendas,
            (t.inicio at time zone 'America/Lima')::date, t.id);
  end if;
  perform set_config('app.perm', coalesce(v_perm, ''), true);
  select minutos into v_min from reclamos where lote_tramo_id = t.id and estado = 'ACTIVO';
  return v_min;
end $function$;
revoke all on function public._lote_minutaje(bigint) from public, anon, authenticated;

-- Igual que el 119, más la base y el número de operación.
create or replace function public._lote_json(l lotes)
 returns json language sql stable security definer set search_path to 'public' as $$
  select json_build_object('id', l.id, 'area', l.area, 'destino', l.destino, 'tarea', l.tarea, 'cantidad', l.cantidad,
    'o_f', l.o_f, 'estado', l.estado, 'creado', l.creado, 'cerrado', l.cerrado,
    'hecho', coalesce(sum(t.prendas), 0),
    'queda', greatest(l.cantidad - coalesce(sum(t.prendas), 0), 0),
    'min', coalesce(sum(_tramo_min(t.inicio, coalesce(t.fin, now()))), 0),
    'min_hoy', coalesce(sum(_tramo_min(greatest(t.inicio, (_hoy()::timestamp at time zone 'America/Lima')), coalesce(t.fin, now())))
                         filter (where coalesce(t.fin, now()) >= (_hoy()::timestamp at time zone 'America/Lima')), 0),
    'min_contado', coalesce(sum(_tramo_min(t.inicio, t.fin)) filter (where t.prendas is not null), 0),
    'ahora', count(*) filter (where t.fin is null),
    'personas', count(distinct t.dni),
    'por_revisar', count(*) filter (where t.fin is not null and t.prendas is null and t.revisado is null),
    'std', _lote_std(l),
    'base', (select b.nombre from lote_base_ops x join lote_bases b on b.id = x.base_id where x.id = l.base_op_id),
    'n_op', (select x.n_op from lote_base_ops x where x.id = l.base_op_id),
    'minutaje', (select coalesce(sum(r.minutos), 0) from reclamos r join lote_tramos x on x.id = r.lote_tramo_id
                  where x.lote_id = l.id and r.estado = 'ACTIVO'))
  from lote_tramos t where t.lote_id = l.id
$$;
revoke all on function public._lote_json(lotes) from public, anon, authenticated;

-- Igual que el 119, pero lo "real" de cada tarea deja fuera los lotes con base
-- (esos usan el tiempo de su base, no el de la tarea).
create or replace function public.fn_lote_tiempos(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_areas text[];
begin
  o := _auth(p_dni, p_token);
  select array_agg(a) into v_areas from unnest(array['DESPACHO','REPROCESO','CORTE']) a where _lote_permiso(o, a, false);
  if v_areas is null then raise exception 'NO_AUTORIZADA: sin acceso a Trabajo por tiempo'; end if;
  return json_build_object('ok', true,
    'areas', (select json_agg(json_build_object('area', a, 'edita', _lote_tiempo_permiso(o, a)) order by a) from unnest(v_areas) a),
    'tareas', coalesce((select json_agg(json_build_object('id', k.id, 'area', k.area, 'nombre', k.nombre, 'std', k.std, 'activo', k.activo,
        'actualizado', k.actualizado, 'por', coalesce(op.nombres_apellidos, k.actualizado_por),
        'prendas', z.prendas, 'min', z.min, 'personas', z.personas, 'tramos', z.tramos,
        'real', case when z.prendas > 0 then round(z.min / z.prendas, 3) end,
        'sin_minutaje', z.sin_mj) order by k.area, k.activo desc, k.id)
      from lote_tareas k
      left join operarios op on op.dni = k.actualizado_por
      left join lateral (
        select coalesce(sum(t.prendas), 0) prendas, coalesce(sum(_tramo_min(t.inicio, t.fin)), 0) min,
               count(distinct t.dni) personas, count(*) tramos,
               count(*) filter (where not exists (select 1 from reclamos r where r.lote_tramo_id = t.id)) sin_mj
          from lote_tramos t join lotes l on l.id = t.lote_id
         where l.area = k.area and l.tarea = k.nombre and l.base_op_id is null and t.prendas > 0 and t.fin is not null
           and t.inicio > now() - interval '30 days') z on true
      where k.area = any(v_areas)), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- Bases ----------
-- Bases de las áreas que ve (DESPACHO y REPROCESO). edita = puede cambiar
-- tiempos (Ingeniería con Edición); crea = puede crear lotes (también la supervisora).
create or replace function public.fn_lote_bases(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_areas text[];
begin
  o := _auth(p_dni, p_token);
  select array_agg(a) into v_areas from unnest(array['DESPACHO','REPROCESO']) a where _lote_permiso(o, a, false);
  if v_areas is null then return json_build_object('ok', true, 'areas', '[]'::json, 'bases', '[]'::json); end if;
  return json_build_object('ok', true,
    'areas', (select json_agg(json_build_object('area', a, 'edita', _lote_tiempo_permiso(o, a), 'crea', _lote_permiso(o, a, true)) order by a)
                from unnest(v_areas) a),
    'bases', coalesce((select json_agg(json_build_object('id', b.id, 'area', b.area, 'nombre', b.nombre, 'activo', b.activo,
        'actualizado', coalesce(b.actualizado, b.creado), 'por', coalesce(op.nombres_apellidos, b.actualizado_por, b.creado_por),
        'abiertos', (select count(*) from lotes l join lote_base_ops x on x.id = l.base_op_id where x.base_id = b.id and l.estado = 'ABIERTO'),
        'ops', coalesce((select json_agg(json_build_object('id', x.id, 'n_op', x.n_op, 'operacion', x.operacion, 'std', x.std) order by x.n_op, x.id)
                           from lote_base_ops x where x.base_id = b.id and x.activo), '[]'::json))
      order by b.area, b.activo desc, b.nombre)
      from lote_bases b left join operarios op on op.dni = coalesce(b.actualizado_por, b.creado_por)
     where b.area = any(v_areas)), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Crea (p_id null) o cambia una base. p_ops: [{id?, operacion, std}] en orden
-- (L-1, L-2…). Las operaciones que ya no vienen quedan ocultas, no se borran
-- (los lotes viejos las siguen usando). Cambiar un tiempo cuenta desde ahora;
-- p_desde además da minutaje a lo ya terminado sin minutaje en lotes de esta
-- base desde ese día (máximo 31 días).
create or replace function public.fn_lote_base_guardar(p_dni text, p_token uuid, p_id integer, p_area text, p_nombre text,
                                                      p_ops json, p_activo boolean, p_desde date)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; b lote_bases; f json; i int := 0; v_op text; v_std numeric; v_oid int;
        v_vistos text[] := '{}'; v_stds numeric[] := '{}'; v_ids int[] := '{}';
        v_area text := upper(trim(coalesce(p_area,'')));
        v_nom  text := upper(regexp_replace(trim(coalesce(p_nombre,'')), '\s+', ' ', 'g'));
        v_apl int := 0; v_min numeric := 0; v_mj numeric; t record;
begin
  o := _auth(p_dni, p_token);
  if p_id is not null then
    select * into b from lote_bases where id = p_id for update;
    if b.id is null then return json_build_object('ok', false, 'error', 'No existe la base'); end if;
    v_area := b.area;
  end if;
  if v_area not in ('DESPACHO','REPROCESO') then return json_build_object('ok', false, 'error', 'Las bases son de DESPACHO o REPROCESO'); end if;
  if not _lote_tiempo_permiso(o, v_area) then raise exception 'NO_AUTORIZADA_AREA: no puedes cambiar bases de %', v_area; end if;
  if v_nom = '' or length(v_nom) > 40 then return json_build_object('ok', false, 'error', 'Ponle nombre a la base (prenda, artículo o cliente; máximo 40 letras)'); end if;
  if p_ops is null or json_typeof(p_ops) <> 'array' or json_array_length(p_ops) = 0 then
    return json_build_object('ok', false, 'error', 'La base necesita al menos una operación'); end if;
  if json_array_length(p_ops) > 60 then return json_build_object('ok', false, 'error', 'Máximo 60 operaciones por base'); end if;
  if p_desde is not null and p_desde < _hoy() - 31 then
    return json_build_object('ok', false, 'error', 'Solo se puede dar minutaje hasta 31 días atrás'); end if;
  if exists (select 1 from lote_bases where area = v_area and nombre = v_nom and id is distinct from p_id) then
    return json_build_object('ok', false, 'error', 'Ya hay una base ' || v_nom || ' en ' || v_area); end if;

  -- Primero se revisa todo; recién después se escribe.
  for f in select * from json_array_elements(p_ops) loop
    i := i + 1;
    v_op := upper(regexp_replace(trim(coalesce(f->>'operacion','')), '\s+', ' ', 'g'));
    begin
      v_std := nullif(replace(trim(coalesce(f->>'std','')), ',', '.'), '')::numeric;
    exception when others then
      return json_build_object('ok', false, 'error', 'Tiempo inválido en ' || v_op || ': ' || coalesce(f->>'std',''));
    end;
    if v_op = '' or length(v_op) > 40 then return json_build_object('ok', false, 'error', 'La operación ' || i || ' no tiene nombre (máximo 40 letras)'); end if;
    if v_op = any(v_vistos) then return json_build_object('ok', false, 'error', v_op || ' está dos veces'); end if;
    if v_std is null or v_std <= 0 or v_std > 600 then
      return json_build_object('ok', false, 'error', 'El tiempo de ' || v_op || ' debe estar entre 0 y 600 min por prenda'); end if;
    v_vistos := v_vistos || v_op;
    v_stds := v_stds || round(v_std, 4);
    v_ids := v_ids || case when (f->>'id') ~ '^[0-9]+$' then (f->>'id')::int end;
  end loop;

  if b.id is null then
    insert into lote_bases (area, nombre, activo, creado_por) values (v_area, v_nom, coalesce(p_activo, true), o.dni) returning * into b;
  else
    update lote_bases set nombre = v_nom, activo = coalesce(p_activo, activo), actualizado = now(), actualizado_por = o.dni
     where id = b.id returning * into b;
  end if;

  update lote_base_ops set activo = false where base_id = b.id;
  for i in 1 .. array_length(v_vistos, 1) loop
    select id into v_oid from lote_base_ops where id = v_ids[i] and base_id = b.id;
    if v_oid is null then
      select id into v_oid from lote_base_ops where base_id = b.id and operacion = v_vistos[i] order by id desc limit 1;
    end if;
    if v_oid is null then
      insert into lote_base_ops (base_id, n_op, operacion, std) values (b.id, i, v_vistos[i], v_stds[i]);
    else
      update lote_base_ops set n_op = i, operacion = v_vistos[i], std = v_stds[i], activo = true where id = v_oid;
    end if;
  end loop;

  if p_desde is not null then
    for t in select x.id from lote_tramos x join lotes l on l.id = x.lote_id join lote_base_ops k on k.id = l.base_op_id
              where k.base_id = b.id and x.prendas > 0 and x.fin is not null
                and (x.inicio at time zone 'America/Lima')::date >= p_desde
                and not exists (select 1 from reclamos r where r.lote_tramo_id = x.id)
              order by x.id loop
      v_mj := _lote_minutaje(t.id);
      if v_mj is not null then v_apl := v_apl + 1; v_min := v_min + v_mj; end if;
    end loop;
  end if;
  return json_build_object('ok', true, 'id', b.id, 'ops', array_length(v_vistos, 1), 'aplicados', v_apl, 'minutaje', round(v_min, 1));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Crea el lote cruzando la base con la cantidad máxima: un lote por operación
-- de la base, en orden, todos con la misma cantidad como tope.
create or replace function public.fn_lote_crear_base(p_dni text, p_token uuid, p_base integer, p_destino text, p_cantidad integer, p_of text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; b lote_bases; x record; v_ids int[] := '{}'; v_id int;
        v_dest text := upper(trim(coalesce(p_destino,'')));
        v_of   text := nullif(upper(trim(coalesce(p_of,''))),'');
begin
  o := _auth(p_dni, p_token);
  select * into b from lote_bases where id = p_base;
  if b.id is null or not b.activo then return json_build_object('ok', false, 'error', 'Esa base no existe o está oculta'); end if;
  if not _lote_permiso(o, b.area, true) then raise exception 'NO_AUTORIZADA_AREA: no puedes crear lotes en %', b.area; end if;
  if v_dest = '' or length(v_dest) > 60 then return json_build_object('ok', false, 'error', 'Escribe el lote, artículo o cliente'); end if;
  if coalesce(p_cantidad,0) <= 0 or p_cantidad > 1000000 then return json_build_object('ok', false, 'error', 'Pon la cantidad de prendas'); end if;
  if not exists (select 1 from lote_base_ops where base_id = b.id and activo) then
    return json_build_object('ok', false, 'error', 'La base ' || b.nombre || ' no tiene operaciones'); end if;
  perform pg_advisory_xact_lock(hashtext('lote_crear:' || o.dni));
  -- Doble toque: el mismo lote de la misma base hace menos de 2 minutos.
  select array_agg(l.id order by k.n_op, l.id) into v_ids from lotes l join lote_base_ops k on k.id = l.base_op_id
   where k.base_id = b.id and l.creado_por = o.dni and l.destino = v_dest and l.cantidad = p_cantidad
     and l.creado > now() - interval '2 minutes';
  if v_ids is not null then return json_build_object('ok', true, 'ids', v_ids, 'repetido', true); end if;
  v_ids := '{}';
  for x in select id, operacion from lote_base_ops where base_id = b.id and activo order by n_op, id loop
    insert into lotes (area, destino, tarea, cantidad, o_f, creado_por, base_op_id)
    values (b.area, v_dest, x.operacion, p_cantidad, v_of, o.dni, x.id) returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  return json_build_object('ok', true, 'ids', v_ids);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_lote_bases(text, uuid) to anon, authenticated;
grant execute on function public.fn_lote_base_guardar(text, uuid, integer, text, text, json, boolean, date) to anon, authenticated;
grant execute on function public.fn_lote_crear_base(text, uuid, integer, text, integer, text) to anon, authenticated;

-- ---------- Arranque: base CAMISA de REPROCESO con lo que ya hay ----------
do $$
declare v_base int; v_por text;
begin
  if exists (select 1 from lote_bases) then return; end if;
  if not exists (select 1 from lote_tareas where area = 'REPROCESO' and activo and std is not null) then return; end if;
  select coalesce(max(actualizado_por), 'SISTEMA') into v_por from lote_tareas where area = 'REPROCESO' and activo and std is not null;
  insert into lote_bases (area, nombre, creado_por) values ('REPROCESO', 'CAMISA', v_por) returning id into v_base;
  insert into lote_base_ops (base_id, n_op, operacion, std)
  select v_base, row_number() over (order by id), nombre, std
    from lote_tareas where area = 'REPROCESO' and activo and std is not null;
  update lotes l set base_op_id = k.id
    from lote_base_ops k
   where k.base_id = v_base and l.area = 'REPROCESO' and l.estado = 'ABIERTO' and l.base_op_id is null and l.tarea = k.operacion;
end $$;

commit;
