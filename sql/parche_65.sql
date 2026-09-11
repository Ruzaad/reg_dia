-- PARCHE 65 — Fix: "statement timeout" al generar tickets (regresión del parche 62)
--
-- Causa: el parche 62 hizo que fn_of_generar y las funciones de bases
-- llamen a fn_tickets_cache_refrescar(p_area), que borra y recalcula TODA
-- la caché del área (hasta 37K+ filas, ~4.5s medido en vivo) por CADA
-- cambio, aunque solo haya cambiado una OF o un artículo. El rol `anon`
-- (con el que corre la sesión, porque la app no usa Supabase Auth) tiene
-- statement_timeout=3s — por eso fn_of_generar empezó a fallar con 500
-- ("canceling statement due to statement timeout"), confirmado en logs:
-- 3 llamadas a fn_of_generar cayendo en ~3.2s cada una.
--
-- Fix: refrescar solo lo que cambió.
--   - fn_tickets_cache_refrescar(p_area, p_of) ahora acepta un OF opcional
--     (reusa el parámetro que fn_tickets_of_raw ya tenía). Medido: refrescar
--     una sola OF toma ~85ms en vez de ~4.5s.
--   - fn_tickets_cache_refrescar_articulo(p_area, p_articulo): nueva,
--     refresca solo las OF generadas de ese artículo (loop por OF, cada una
--     ya rápida por lo anterior).
--   - Cada función de escritura llama a la versión más angosta posible en
--     vez de refrescar el área entera.
--   - Además se les puso SET statement_timeout TO '30s' (igual que
--     fn_tickets_area) como colchón adicional, ya que son acciones de
--     ingeniería, no de alto tráfico como las del operario.

create or replace function fn_tickets_cache_refrescar(p_area text, p_of text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_of is null then
    delete from tickets_cache where area = p_area;
  else
    delete from tickets_cache where area = p_area and o_f = p_of;
  end if;
  insert into tickets_cache (area, codigo, o_f, articulo, modulo, op, n_op, op_id,
    std, cant, paq, talla, color, desde, hasta)
  select p_area, codigo, o_f, articulo, modulo, op, n_op, op_id,
    std, cant, paq, talla, color, desde, hasta
  from fn_tickets_of_raw(p_area, p_of);
end $$;

create or replace function fn_tickets_cache_refrescar_articulo(p_area text, p_articulo text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  for r in select g.o_f from of_generada g join ofs f on f.o_f = g.o_f
            where g.area = p_area and _nk(f.articulo) = _nk(p_articulo)
  loop
    perform fn_tickets_cache_refrescar(p_area, r.o_f);
  end loop;
end $$;

-- ---- Cada función de escritura pasa a refrescar solo lo que cambió ----

create or replace function public.fn_base_articulo_eliminar(p_dni text, p_token text, p_area text, p_articulo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v_n int;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if coalesce(trim(p_articulo),'') = '' then
    return json_build_object('ok', false, 'error', 'Artículo obligatorio');
  end if;
  delete from bases
   where area = p_area and upper(trim(articulo)) = upper(trim(p_articulo));
  get diagnostics v_n = row_count;
  perform fn_tickets_cache_refrescar_articulo(p_area, p_articulo);
  return json_build_object('ok', true, 'eliminadas', v_n);
exception
  when others then
    if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
    return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_base_articulo_guardar(p_dni text, p_token text, p_area text, p_articulo text, p_prenda text, p_cliente text, p_articulo_nuevo text, p_filas jsonb)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v_art text; v_art_new text; v_n int := 0; v_dup text; v_ids bigint[];
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  v_art := upper(trim(coalesce(p_articulo,'')));
  if v_art = '' then return json_build_object('ok',false,'error','Falta el artículo'); end if;
  v_art_new := coalesce(nullif(upper(trim(coalesce(p_articulo_nuevo,''))),''), v_art);
  if jsonb_typeof(p_filas) <> 'array' then
    return json_build_object('ok',false,'error','Nada que guardar'); end if;

  select array_agg((x->>'id')::bigint) into v_ids
    from jsonb_array_elements(p_filas) x;
  if exists (select 1 from bases b
              where b.id = any(v_ids)
                and (b.area <> p_area or upper(trim(b.articulo)) <> v_art)) then
    return json_build_object('ok',false,'error','Hay filas que no son de este artículo o área'); end if;

  select string_agg(distinct op, ', ') into v_dup
    from (select _nk(x->>'operacion') op, count(*) n
            from jsonb_array_elements(p_filas) x
           where coalesce(trim(x->>'operacion'),'') <> ''
           group by 1 having count(*) > 1) z;
  if v_dup is not null then
    return json_build_object('ok',false,'error',
      'Hay operaciones repetidas dentro del artículo: '||v_dup||'. Corrígelas antes de guardar.'); end if;

  if exists (select 1 from jsonb_array_elements(p_filas) x
              where coalesce(trim(x->>'operacion'),'') = '') then
    return json_build_object('ok',false,'error','Ninguna operación puede quedar sin nombre'); end if;

  update bases b set
      articulo  = v_art_new,
      prenda    = coalesce(nullif(trim(p_prenda),''),  b.prenda),
      cliente   = coalesce(nullif(trim(p_cliente),''), b.cliente),
      modulo    = coalesce(nullif(trim(f.modulo),''),  b.modulo),
      operacion = trim(f.operacion),
      std       = coalesce(f.std, b.std),
      n_op      = coalesce(nullif(f.n_op,0), b.n_op),
      subido_por = p_dni
    from (select (x->>'id')::bigint id,
                 x->>'modulo' modulo,
                 x->>'operacion' operacion,
                 nullif(x->>'std','')::numeric std,
                 coalesce(nullif(x->>'n_op','')::int,0) n_op
            from jsonb_array_elements(p_filas) x) f
   where b.id = f.id and b.area = p_area;
  get diagnostics v_n = row_count;

  perform _base_resecuenciar(p_area, v_art_new, NULL);
  if v_art_new <> v_art then perform _base_resecuenciar(p_area, v_art, NULL); end if;
  perform fn_tickets_cache_refrescar_articulo(p_area, v_art_new);
  if v_art_new <> v_art then perform fn_tickets_cache_refrescar_articulo(p_area, v_art); end if;

  return json_build_object('ok', true, 'filas', v_n, 'articulo', v_art_new,
    'reclamos_actualizados', _sync_reclamos_articulo(p_area, v_art_new)
      + case when v_art_new <> v_art then _sync_reclamos_articulo(p_area, v_art) else 0 end);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_base_op_crear(p_dni text, p_token text, p_area text, p_prenda text, p_cliente text, p_modulo text, p_articulo text, p_operacion text, p_std numeric, p_max_op integer, p_n_op integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v_id bigint; v_art text; v_prop int := 0;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if coalesce(trim(p_articulo),'') = '' or coalesce(trim(p_operacion),'') = '' then
    return json_build_object('ok', false, 'error', 'Artículo y operación son obligatorios');
  end if;
  v_art := upper(trim(p_articulo));
  insert into bases (area, prenda, cliente, modulo, articulo, operacion, std, max_op, n_op, subido_por)
  values (p_area, p_prenda, p_cliente, p_modulo, v_art, p_operacion,
          coalesce(p_std,0), 0, coalesce(nullif(p_n_op,0), 999999), p_dni)
  returning id into v_id;
  perform _base_resecuenciar(p_area, v_art, v_id);
  v_prop := _sync_reclamos_articulo(p_area, v_art);
  perform fn_tickets_cache_refrescar_articulo(p_area, v_art);
  return json_build_object('ok', true, 'id', v_id, 'reclamos_actualizados', v_prop);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_base_op_editar(p_dni text, p_token text, p_id bigint, p_prenda text, p_cliente text, p_modulo text, p_articulo text, p_operacion text, p_std numeric, p_max_op integer, p_n_op integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v_area text; v_art_old text; v_art text; v_prop int := 0;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if coalesce(trim(p_articulo),'') = '' or coalesce(trim(p_operacion),'') = '' then
    return json_build_object('ok', false, 'error', 'Artículo y operación son obligatorios');
  end if;
  select area, upper(trim(articulo)) into v_area, v_art_old from bases where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'No existe esa fila'); end if;
  v_art := upper(trim(p_articulo));
  update bases set
    prenda = p_prenda, cliente = p_cliente, modulo = p_modulo,
    articulo = v_art, operacion = p_operacion,
    std = coalesce(p_std,0), n_op = coalesce(nullif(p_n_op,0), 999999)
  where id = p_id;
  perform _base_resecuenciar(v_area, v_art, p_id);
  if v_art_old <> v_art then perform _base_resecuenciar(v_area, v_art_old, NULL); end if;
  v_prop := _sync_reclamos_articulo(v_area, v_art);
  if v_art_old <> v_art then v_prop := v_prop + _sync_reclamos_articulo(v_area, v_art_old); end if;
  perform fn_tickets_cache_refrescar_articulo(v_area, v_art);
  if v_art_old <> v_art then perform fn_tickets_cache_refrescar_articulo(v_area, v_art_old); end if;
  return json_build_object('ok', true, 'reclamos_actualizados', v_prop);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_base_op_eliminar(p_dni text, p_token text, p_id bigint)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v_area text; v_art text; v_prop int := 0;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  select area, upper(trim(articulo)) into v_area, v_art from bases where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'No existe esa fila'); end if;
  delete from bases where id = p_id;
  perform _base_resecuenciar(v_area, v_art, NULL);
  v_prop := _sync_reclamos_articulo(v_area, v_art);
  perform fn_tickets_cache_refrescar_articulo(v_area, v_art);
  return json_build_object('ok', true, 'reclamos_actualizados', v_prop);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_base_op_eliminar(p_dni text, p_token text, p_id bigint, p_confirmar boolean)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v_area text; v_art text; v_op text; v_opid bigint; v_n int; v_prop int := 0;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  select area, upper(trim(articulo)), operacion, op_id
    into v_area, v_art, v_op, v_opid
    from bases where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'No existe esa fila'); end if;

  select count(*) into v_n from reclamos r
   where r.op_id = v_opid and r.estado = 'ACTIVO';

  if v_n > 0 and not coalesce(p_confirmar, false) then
    return json_build_object('ok', false, 'requiere_confirmacion', true,
      'operacion', v_op, 'reclamos', v_n,
      'error', 'La operación "'||v_op||'" tiene '||v_n||' reclamo(s) activo(s). '
             ||'Si la borras, ese trabajo queda fuera de la ruta (conserva sus minutos).');
  end if;

  delete from bases where id = p_id;
  perform _base_resecuenciar(v_area, v_art, NULL);
  v_prop := _sync_reclamos_articulo(v_area, v_art);
  perform fn_tickets_cache_refrescar_articulo(v_area, v_art);
  return json_build_object('ok', true, 'reclamos_actualizados', v_prop, 'reclamos_sueltos', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_bases_subir(p_dni text, p_token uuid, p_area text, p_filas jsonb)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare o operarios; arts text[]; v_prop int := 0;
        v_new int := 0; v_upd int := 0; v_del int := 0; v_conflicto text; v_art text;
begin
  o := _ing(p_dni, p_token);
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'Archivo vacío');
  end if;

  drop table if exists _sub;
  create temp table _sub on commit drop as
  select upper(trim(x->>'articulo')) articulo,
         _nk(x->>'articulo') ka,
         _nk(x->>'operacion') ko,
         x->>'prenda' prenda, x->>'cliente' cliente, x->>'modulo' modulo,
         x->>'operacion' operacion,
         coalesce((x->>'std')::numeric,0) std,
         coalesce((x->>'max_op')::int,0) max_op,
         coalesce((x->>'n_op')::int,0) n_op
    from jsonb_array_elements(p_filas) x;

  select array_agg(distinct articulo) into arts from _sub;

  select string_agg(distinct articulo||' · '||operacion, ', ')
    into v_conflicto
    from _sub s
   where (select count(*) from _sub z where z.ka = s.ka and z.ko = s.ko) > 1;
  if v_conflicto is not null then
    return json_build_object('ok', false, 'error',
      'El archivo repite la misma operación dentro del artículo: '||v_conflicto
      ||'. Corrígelo antes de subir.');
  end if;

  select string_agg(distinct b.operacion||' (N°OP '||b.n_op||', '||b.articulo||')', ', ')
    into v_conflicto
    from bases b
   where b.area = p_area and upper(trim(b.articulo)) = any(arts)
     and not exists (select 1 from _sub s where s.ka = _nk(b.articulo) and s.ko = _nk(b.operacion))
     and exists (select 1 from reclamos r where r.op_id = b.op_id and r.estado = 'ACTIVO');
  if v_conflicto is not null then
    return json_build_object('ok', false, 'error',
      'No se subió nada. Estas operaciones desaparecerían del artículo y tienen '
      ||'reclamos activos: '||v_conflicto||'. Si las renombraste, hazlo desde '
      ||'Base → editar operación y vuelve a subir el Excel.');
  end if;

  update bases b set
      prenda = s.prenda, cliente = s.cliente, modulo = s.modulo,
      operacion = s.operacion, std = s.std, max_op = s.max_op, n_op = s.n_op,
      subido_por = o.dni
    from _sub s
   where b.area = p_area and _nk(b.articulo) = s.ka and _nk(b.operacion) = s.ko;
  get diagnostics v_upd = row_count;

  delete from bases b
   where b.area = p_area and upper(trim(b.articulo)) = any(arts)
     and not exists (select 1 from _sub s where s.ka = _nk(b.articulo) and s.ko = _nk(b.operacion));
  get diagnostics v_del = row_count;

  insert into bases (area, prenda, cliente, modulo, articulo, operacion, std, max_op, n_op, subido_por)
  select p_area, s.prenda, s.cliente, s.modulo, s.articulo, s.operacion,
         s.std, s.max_op, s.n_op, o.dni
    from _sub s
   where not exists (select 1 from bases b
                      where b.area = p_area and _nk(b.articulo) = s.ka and _nk(b.operacion) = s.ko);
  get diagnostics v_new = row_count;

  v_prop := _propagar_std_articulos(p_area, arts);
  foreach v_art in array coalesce(arts,'{}') loop
    perform fn_tickets_cache_refrescar_articulo(p_area, v_art);
  end loop;

  return json_build_object('ok', true, 'articulos', arts,
    'filas', jsonb_array_length(p_filas),
    'nuevas', v_new, 'actualizadas', v_upd, 'eliminadas', v_del,
    'reclamos_actualizados', v_prop);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_of_generar(p_dni text, p_token uuid, p_area text, p_of text, p_troceo jsonb)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare s operarios; f ofs; n_paq integer; n_ops integer; n_tro integer; ya boolean;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;

  select * into f from ofs where _nk(o_f) = _nk(p_of);
  if not found then
    return json_build_object('ok',false,'error','La OF no está registrada. Súbela primero en OFs registradas.'); end if;

  select count(*) into n_paq from of_detalle where o_f = f.o_f;
  if n_paq = 0 then
    return json_build_object('ok',false,'error','La OF no tiene desglose de paquetes. Complétalo con su HN antes de generar.'); end if;

  select count(*) into n_ops from _ruta(p_area, f.articulo);
  if n_ops = 0 then
    return json_build_object('ok',false,'error','No hay BASE cargada para '||f.articulo||' en '||p_area); end if;

  select exists(select 1 from reclamos r
                where r.area = p_area and _nk(r.o_f) = _nk(f.o_f) and r.estado = 'ACTIVO')
    into ya;
  if ya then
    return json_build_object('ok',false,'error',
      'Ya hay tickets reclamados de esta OF en '||p_area||'. Libéralos antes de cambiar el troceo.'); end if;

  insert into of_generada (o_f, area, generada_por) values (f.o_f, p_area, s.dni)
  on conflict (o_f, area) do update set generada = now(), generada_por = excluded.generada_por;

  delete from of_troceo where o_f = f.o_f and area = p_area;
  insert into of_troceo (o_f, area, op_id, n_op, n)
  select f.o_f, p_area, r.op_id, r.n_op, (x->>'n')::int
  from jsonb_array_elements(coalesce(p_troceo,'[]'::jsonb)) x
  cross join lateral (
    select r2.op_id, r2.n_op
      from _ruta(p_area, f.articulo) r2
     where case when nullif(x->>'op_id','') is not null
                then r2.op_id = (x->>'op_id')::bigint
                else r2.n_op = coalesce(nullif(x->>'n_op','')::int, -1) end
     limit 1) r
  where coalesce((x->>'n')::int,0) > 0;
  get diagnostics n_tro = row_count;

  perform fn_tickets_cache_refrescar(p_area, f.o_f);

  return json_build_object('ok',true,'of',f.o_f,'operaciones',n_ops,'paquetes',n_paq,
    'troceadas',n_tro,'tickets',(select count(*) from fn_tickets_of_raw(p_area, f.o_f)));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_of_registrar(p_dni text, p_token uuid, p_of text, p_articulo text, p_prenda text, p_cant_prog numeric, p_div_ultima integer, p_div_penultima integer, p_detalle jsonb)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare s operarios; e ofs; v_of text; v_pre text; d text[] := '{}';
        n integer; nh integer; v_hay boolean; v_area_gen text;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  v_of := upper(trim(coalesce(p_of,'')));
  if v_of = '' then return json_build_object('ok',false,'error','OF vacia'); end if;
  if coalesce(p_cant_prog,0) <= 0 then
    return json_build_object('ok',false,'error','Cantidad programada invalida'); end if;
  v_pre := coalesce(nullif(upper(trim(coalesce(p_prenda,''))),''), '');
  nh := coalesce(jsonb_array_length(p_detalle),0);

  select * into e from ofs where o_f = v_of;

  if found then
    if _nk(e.articulo) is distinct from _nk(p_articulo) then
      d := d || ('articulo: registrado '||e.articulo||' vs HN '||coalesce(p_articulo,'-')); end if;

    select exists(select 1 from of_detalle x where x.o_f = v_of and x.prenda = v_pre)
      into v_hay;

    if not v_hay and v_pre <> '' then
      if e.cant_prog <> p_cant_prog then
        d := d || ('corte: la OF tiene '||e.cant_prog::text||' y esta hoja trae '||p_cant_prog::text); end if;

      insert into of_detalle(o_f, prenda, paq, talla, color, cant, desde, hasta)
      select v_of, v_pre, (x->>'paq')::int, nullif(trim(x->>'talla'),''),
             nullif(upper(trim(coalesce(x->>'color',''))),''),
             (x->>'cant')::numeric, (x->>'desde')::int, (x->>'hasta')::int
      from jsonb_array_elements(coalesce(p_detalle,'[]'::jsonb)) x
      where coalesce((x->>'cant')::numeric,0) > 0;
      get diagnostics n = row_count;

      for v_area_gen in select area from of_generada where o_f = v_of loop
        perform fn_tickets_cache_refrescar(v_area_gen, v_of);
      end loop;

      return json_build_object('ok',true,'creada',true,'prenda_nueva',true,
        'of',v_of,'prenda',v_pre,'paquetes',n,'cant_prog',p_cant_prog,
        'difiere', to_json(d));
    end if;

    if e.cant_prog <> p_cant_prog then
      d := d || ('cantidad: registrada '||e.cant_prog::text||' vs HN '||p_cant_prog::text); end if;
    select count(*) into n from of_detalle where o_f = v_of and prenda = v_pre;
    if n <> nh then
      d := d || ('paquetes: registrados '||n::text||' vs HN '||nh::text); end if;
    return json_build_object('ok',true,'creada',false,'of',v_of,'prenda',v_pre,
      'fecha_carga', to_char(e.fecha_carga at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'cargado_por', e.cargado_por, 'difiere', to_json(d));
  end if;

  insert into ofs(o_f, articulo, prenda, cant_prog, div_ultima_n, div_penultima_n, cargado_por)
  values (v_of, upper(trim(coalesce(p_articulo,''))), nullif(v_pre,''),
          p_cant_prog, nullif(p_div_ultima,0), nullif(p_div_penultima,0), s.dni);

  insert into of_detalle(o_f, prenda, paq, talla, color, cant, desde, hasta)
  select v_of, v_pre, (x->>'paq')::int, nullif(trim(x->>'talla'),''),
         nullif(upper(trim(coalesce(x->>'color',''))),''),
         (x->>'cant')::numeric, (x->>'desde')::int, (x->>'hasta')::int
  from jsonb_array_elements(coalesce(p_detalle,'[]'::jsonb)) x
  where coalesce((x->>'cant')::numeric,0) > 0;
  get diagnostics n = row_count;

  return json_build_object('ok',true,'creada',true,'of',v_of,'prenda',v_pre,
    'paquetes',n,'cant_prog',p_cant_prog);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
