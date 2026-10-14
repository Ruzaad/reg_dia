-- ROLLBACK PARCHE 126 — vuelve a como dejó el parche 123.
-- Vuelve el editor de bases por lotes (parche 123) y la entrada a REPROCESO por
-- lotes. Borra las OF provisionales y las bases de REPROCESO que NO tengan
-- registros; las que ya tienen reclamos se quedan. Los lotes por tiempo de
-- REPROCESO que el 126 cerró siguen cerrados (se reabren a mano desde
-- Trabajo por tiempo si hace falta).
begin;
drop function if exists public.fn_reproceso_lote_crear(text, uuid, text, text, integer);
drop function if exists public.fn_reproceso_bases(text, uuid);
delete from public.ofs o where o.reproceso and not exists (select 1 from reclamos r where r.area = 'REPROCESO' and _nk(r.o_f) = _nk(o.o_f));
delete from public.bases b where b.area = 'REPROCESO' and not exists (select 1 from reclamos r where r.op_id = b.op_id);
alter table public.ofs drop column if exists reproceso;

create or replace function public._lote_area_hoy(o operarios)
 returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select e.area from lote_area_elegida e where e.dni = o.dni and e.fecha = _hoy()),
    (select case a.estado when 'EN DESPACHO' then 'DESPACHO' when 'EN REPROCESO' then 'REPROCESO' when 'EN CORTE' then 'CORTE' end
       from asistencia a where a.dni = o.dni and a.fecha = _hoy()
      order by a.creado desc limit 1),
    case when o.area_actual in ('CORTE','REPROCESO') then o.area_actual end)
$$;
revoke all on function public._lote_area_hoy(operarios) from public, anon, authenticated;

create or replace function public.fn_lote_elegir_area(p_dni text, p_token uuid, p_area text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_area text := upper(trim(coalesce(p_area,'')));
begin
  o := _auth(p_dni, p_token);
  if o.cargo not in ('OPERARIO','ESTAJERO') then return json_build_object('ok', true, 'area', null); end if;
  if v_area not in ('DESPACHO','REPROCESO','CORTE') then
    delete from lote_area_elegida where dni = o.dni and fecha = _hoy();
    return json_build_object('ok', true, 'area', null);
  end if;
  insert into lote_area_elegida (dni, fecha, area) values (o.dni, _hoy(), v_area)
  on conflict (dni, fecha) do update set area = excluded.area, creado = now();
  return json_build_object('ok', true, 'area', v_area);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

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

commit;
