-- Parche 195: OFs registradas (editar / borrar) + rol Admin asignable
-- + tablas de incentivo solo para Admin + limpieza de lo retirado.
-- Una sola transacción, se puede correr más de una vez.
begin;

/* ============================================================
   1. OFs registradas: editar y borrar
   ============================================================ */

-- Cuenta lo que cuelga de una OF (tickets, reclamos, generación, lotes…).
create or replace function public._of_uso(p_of text)
returns json language sql stable security definer set search_path to 'public' as $$
  select json_build_object(
    'reclamos',   (select count(*) from reclamos where o_f = p_of),
    'tickets',    (select count(*) from tickets_cache where o_f = p_of),
    'generada',   (select count(*) from of_generada where o_f = p_of),
    'lotes',      (select count(*) from lotes where o_f = p_of),
    'ajustes',    (select count(*) from solicitudes_ajuste where o_f = p_of),
    'ops_extra',  (select count(*) from ops_adicionales_of where o_f = p_of),
    'cerrados',   (select count(*) from modulos_cerrados where o_f = p_of),
    'residuales', (select count(*) from residuales where o_f = p_of),
    'repr_ajuste',(select count(*) from reproceso_lote_ajuste where o_f = p_of),
    'repr_reclas',(select count(*) from reproceso_reclasif where o_f = p_of));
$$;
revoke execute on function public._of_uso(text) from public, anon, authenticated;

create or replace function public.fn_of_editar(
  p_dni text, p_token uuid, p_of text,
  p_of_nueva text default null, p_articulo text default null, p_prenda text default null)
returns json language plpgsql security definer set search_path to 'public'
set statement_timeout to '20s' as $$
declare
  o operarios; r ofs; nueva text; art text; pre text; uso json; en_uso boolean; cambia boolean;
  antes jsonb;
begin
  o := _vista(p_dni, p_token, array['pasoOfs'], null);
  perform set_config('app.dni', o.dni, true);
  select * into r from ofs where o_f = p_of;
  if not found then return json_build_object('ok', false, 'error', 'La OF '||coalesce(p_of,'')||' no existe'); end if;
  if coalesce(r.reproceso, false) then
    return json_build_object('ok', false, 'error', 'Es un lote de REPROCESO: se maneja en Reproceso');
  end if;
  nueva := coalesce(nullif(trim(p_of_nueva), ''), r.o_f);
  art   := coalesce(nullif(upper(trim(p_articulo)), ''), r.articulo);
  pre   := coalesce(nullif(upper(trim(p_prenda)), ''), r.prenda);
  cambia := nueva <> r.o_f or art is distinct from r.articulo or pre is distinct from r.prenda;
  if not cambia then return json_build_object('ok', true, 'sin_cambios', true); end if;
  if nueva <> r.o_f and exists (select 1 from ofs where o_f = nueva) then
    return json_build_object('ok', false, 'error', 'La OF '||nueva||' ya está registrada');
  end if;
  uso := _of_uso(r.o_f);
  select bool_or((v.value)::text::int > 0) into en_uso from json_each(uso) v;
  if en_uso then
    return json_build_object('ok', false, 'en_uso', true, 'uso', uso,
      'error', 'La OF ya tiene tickets, reclamos o lotes: no se puede cambiar');
  end if;
  antes := to_jsonb(r);
  if nueva <> r.o_f then
    r.o_f := nueva; r.articulo := art; r.prenda := pre;
    insert into ofs select r.*;
    update of_detalle set o_f = nueva where o_f = p_of;
    update of_troceo set o_f = nueva where o_f = p_of;
    update of_area_conteo set o_f = nueva where o_f = p_of;
    update pcp_programa set o_f = nueva where o_f = p_of;
    update pcp_cronograma set o_f = nueva where o_f = p_of;
    update pcp_corte set o_f = nueva where o_f = p_of;
    delete from ofs where o_f = p_of;
  else
    update ofs set articulo = art, prenda = pre where o_f = p_of;
  end if;
  if p_prenda is not null and (select count(distinct prenda) from of_detalle where o_f = nueva) <= 1 then
    update of_detalle set prenda = pre where o_f = nueva;
  end if;
  insert into correcciones_log(dni, tabla, accion, antes, despues)
  values (o.dni, 'ofs', 'EDITAR', antes, to_jsonb((select x from ofs x where x.o_f = nueva)));
  return json_build_object('ok', true, 'of', nueva);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.fn_of_eliminar(p_dni text, p_token uuid, p_of text)
returns json language plpgsql security definer set search_path to 'public'
set statement_timeout to '20s' as $$
declare o operarios; r ofs; uso json; en_uso boolean; n_det int; n_pcp int;
begin
  o := _vista(p_dni, p_token, array['pasoOfs'], null);
  perform set_config('app.dni', o.dni, true);
  select * into r from ofs where o_f = p_of;
  if not found then return json_build_object('ok', false, 'error', 'La OF '||coalesce(p_of,'')||' no existe'); end if;
  if coalesce(r.reproceso, false) then
    return json_build_object('ok', false, 'error', 'Es un lote de REPROCESO: se maneja en Reproceso');
  end if;
  uso := _of_uso(p_of);
  select bool_or((v.value)::text::int > 0) into en_uso from json_each(uso) v;
  if en_uso then
    return json_build_object('ok', false, 'en_uso', true, 'uso', uso,
      'error', 'La OF ya tiene tickets, reclamos o lotes: no se puede borrar');
  end if;
  select count(*) into n_det from of_detalle where o_f = p_of;
  select (select count(*) from pcp_programa where o_f = p_of)
       + (select count(*) from pcp_cronograma where o_f = p_of)
       + (select count(*) from pcp_corte where o_f = p_of) into n_pcp;
  delete from of_troceo where o_f = p_of;
  delete from of_area_conteo where o_f = p_of;
  delete from of_detalle where o_f = p_of;
  delete from ofs where o_f = p_of;
  insert into correcciones_log(dni, tabla, accion, antes)
  values (o.dni, 'ofs', 'ELIMINAR', to_jsonb(r) || jsonb_build_object('paquetes', n_det));
  return json_build_object('ok', true, 'paquetes', n_det, 'pcp', n_pcp);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

grant execute on function public.fn_of_editar(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.fn_of_eliminar(text, uuid, text) to anon, authenticated;

/* ============================================================
   2. Rol Admin asignable (sin DNI escritos en código)
   ============================================================ */
create or replace function public.fn_admin_asignar(
  p_dni text, p_token uuid, p_usuario text, p_admin boolean)
returns json language plpgsql security definer set search_path to 'public' as $$
declare o operarios; u operarios; otros int;
begin
  o := _admin(p_dni, p_token);
  select * into u from operarios where dni = p_usuario;
  if not found then return json_build_object('ok', false, 'error', 'El usuario no existe'); end if;
  if coalesce(p_admin, false) then
    if u.cargo <> 'INGENIERIA' then
      return json_build_object('ok', false, 'error', 'Solo un usuario de Ingeniería puede ser Admin');
    end if;
  else
    select count(*) into otros from operarios
     where es_admin and estado = 'ACTIVO' and dni <> p_usuario;
    if otros = 0 then
      return json_build_object('ok', false, 'error', 'Debe quedar al menos un Admin activo');
    end if;
  end if;
  update operarios set es_admin = coalesce(p_admin, false) where dni = p_usuario;
  insert into correcciones_log(dni, tabla, accion, dni_op, antes, despues)
  values (o.dni, 'operarios', 'ADMIN', p_usuario,
          jsonb_build_object('es_admin', coalesce(u.es_admin, false)),
          jsonb_build_object('es_admin', coalesce(p_admin, false)));
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;
grant execute on function public.fn_admin_asignar(text, uuid, text, boolean) to anon, authenticated;

/* ============================================================
   3. Tablas de incentivo: ver con la pestaña, editar solo Admin.
      Cada tabla se guarda completa (agregar, editar y borrar % en un solo
      paso, validado y transaccional). Sin tope de filas; el % ya no se limita
      a 80-100 (la nueva tabla llega a 130).
   ============================================================ */
alter table public.incentivos_tabla drop constraint if exists incentivos_tabla_pct_check;
alter table public.incentivos_tabla add constraint incentivos_tabla_pct_check check (pct >= 0 and pct <= 300);
alter table public.bono_modular_tabla drop constraint if exists bono_modular_tabla_pct_check;
alter table public.bono_modular_tabla add constraint bono_modular_tabla_pct_check check (pct >= 0 and pct <= 300);

create or replace function public.fn_incentivos_tabla_guardar(p_dni text, p_token uuid, p_items jsonb)
returns json language plpgsql security definer set search_path to 'public' as $$
declare o operarios; antes jsonb; v_mal int; v_dup text; v_nuevas int; v_borradas int; v_total int;
begin
  o := _admin(p_dni, p_token);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'La tabla no puede quedar vacía');
  end if;
  select count(*) into v_mal from jsonb_array_elements(p_items) x
   where not (upper(coalesce(x->>'categoria','')) in ('A','B','C','D')
          and coalesce(x->>'pct','') ~ '^[0-9]{1,3}$'
          and coalesce(x->>'soles','') ~ '^[0-9]{1,5}(\.[0-9]{1,2})?$');
  if v_mal > 0 then
    return json_build_object('ok', false, 'error', v_mal||' fila(s) inválidas: categoría A-D, porcentaje entero y monto con hasta 2 decimales');
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x where (x->>'pct')::int > 300) then
    return json_build_object('ok', false, 'error', 'El porcentaje no puede pasar de 300');
  end if;
  select string_agg(c||' '||p||'%', ', ') into v_dup from (
    select upper(x->>'categoria') c, (x->>'pct')::int p from jsonb_array_elements(p_items) x
     group by 1, 2 having count(*) > 1) d;
  if v_dup is not null then
    return json_build_object('ok', false, 'error', 'Porcentaje repetido: '||v_dup);
  end if;
  select coalesce(jsonb_agg(to_jsonb(t)), '[]') into antes from incentivos_tabla t;
  with it as (select upper(x->>'categoria') c, (x->>'pct')::int p, (x->>'soles')::numeric s
                from jsonb_array_elements(p_items) x),
       del as (delete from incentivos_tabla t
                where not exists (select 1 from it where it.c = t.categoria and it.p = t.pct) returning 1),
       up as (insert into incentivos_tabla(categoria, pct, soles) select c, p, s from it
              on conflict (categoria, pct) do update set soles = excluded.soles
              returning (xmax = 0) nuevo)
  select (select count(*) from up where nuevo), (select count(*) from del), (select count(*) from up)
    into v_nuevas, v_borradas, v_total;
  insert into correcciones_log(dni, tabla, accion, antes) values (o.dni, 'incentivos_tabla', 'EDITAR', antes);
  return json_build_object('ok', true, 'filas', v_total, 'nuevas', v_nuevas, 'borradas', v_borradas);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.fn_bono_modular_tabla_guardar(p_dni text, p_token uuid, p_items jsonb)
returns json language plpgsql security definer set search_path to 'public' as $$
declare o operarios; antes jsonb; v_mal int; v_dup text; v_nuevas int; v_borradas int; v_total int;
begin
  o := _admin(p_dni, p_token);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    return json_build_object('ok', false, 'error', 'La tabla no puede quedar vacía');
  end if;
  select count(*) into v_mal from jsonb_array_elements(p_items) x
   where not (coalesce(x->>'pct','') ~ '^[0-9]{1,3}$'
          and coalesce(x->>'soles','') ~ '^[0-9]{1,5}(\.[0-9]{1,2})?$');
  if v_mal > 0 then
    return json_build_object('ok', false, 'error', v_mal||' fila(s) inválidas: porcentaje entero y monto con hasta 2 decimales');
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x where (x->>'pct')::int > 300) then
    return json_build_object('ok', false, 'error', 'El porcentaje no puede pasar de 300');
  end if;
  select string_agg(p||'%', ', ') into v_dup from (
    select (x->>'pct')::int p from jsonb_array_elements(p_items) x group by 1 having count(*) > 1) d;
  if v_dup is not null then
    return json_build_object('ok', false, 'error', 'Porcentaje repetido: '||v_dup);
  end if;
  select coalesce(jsonb_agg(to_jsonb(t)), '[]') into antes from bono_modular_tabla t;
  with it as (select (x->>'pct')::int p, (x->>'soles')::numeric s from jsonb_array_elements(p_items) x),
       del as (delete from bono_modular_tabla t where not exists (select 1 from it where it.p = t.pct) returning 1),
       up as (insert into bono_modular_tabla(pct, soles) select p, s from it
              on conflict (pct) do update set soles = excluded.soles
              returning (xmax = 0) nuevo)
  select (select count(*) from up where nuevo), (select count(*) from del), (select count(*) from up)
    into v_nuevas, v_borradas, v_total;
  insert into correcciones_log(dni, tabla, accion, antes) values (o.dni, 'bono_modular_tabla', 'EDITAR', antes);
  return json_build_object('ok', true, 'filas', v_total, 'nuevas', v_nuevas, 'borradas', v_borradas);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;
grant execute on function public.fn_incentivos_tabla_guardar(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.fn_bono_modular_tabla_guardar(text, uuid, jsonb) to anon, authenticated;

/* ============================================================
   3b. Bases: varios artículos nuevos en una sola llamada.
       Los que ya existen en el área se saltan (no se reemplazan);
       los inválidos se devuelven con el motivo; el resto se inserta en lote.
   ============================================================ */
create or replace function public.fn_bases_agregar_varios(p_dni text, p_token uuid, p_area text, p_filas jsonb)
returns json language plpgsql security definer set search_path to 'public'
set statement_timeout to '30s' as $$
declare o operarios; v_dup jsonb; v_inv jsonb; v_ok jsonb; v_filas int := 0; v_art text;
begin
  o := _ing(p_dni, p_token);
  if coalesce(trim(p_area), '') = '' then return json_build_object('ok', false, 'error', 'Elige el área'); end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'No hay filas para registrar');
  end if;
  if jsonb_array_length(p_filas) > 5000 then
    return json_build_object('ok', false, 'error', 'Máximo 5000 filas por carga');
  end if;

  drop table if exists _bv;
  create temp table _bv on commit drop as
  select t.n::int n, upper(trim(coalesce(x->>'articulo',''))) articulo, _nk(x->>'articulo') ka,
         trim(coalesce(x->>'operacion','')) operacion, _nk(x->>'operacion') ko,
         upper(trim(coalesce(x->>'prenda',''))) prenda, upper(trim(coalesce(x->>'cliente',''))) cliente,
         trim(coalesce(x->>'modulo','')) modulo,
         trim(coalesce(x->>'std','0')) std_t, trim(coalesce(x->>'n_op','')) nop_t, null::text motivo
    from jsonb_array_elements(p_filas) with ordinality t(x, n);

  update _bv set motivo = case
      when articulo = '' then 'Sin artículo'
      when operacion = '' then 'Sin operación'
      when std_t !~ '^[0-9]{1,4}([.][0-9]{1,3})?$' then 'STD inválido'
      when nop_t <> '' and nop_t !~ '^[1-9][0-9]{0,2}$' then 'N°OP inválido' end;
  update _bv b set motivo = 'Operación repetida'
   where b.motivo is null and exists (select 1 from _bv z where z.ka = b.ka and z.ko = b.ko and z.n <> b.n);
  update _bv b set motivo = 'N°OP repetido'
   where b.motivo is null and b.nop_t <> '' and exists (select 1 from _bv z where z.ka = b.ka and z.nop_t = b.nop_t and z.n <> b.n);
  update _bv b set motivo = 'N°OP incompleto'
   where b.motivo is null and exists (select 1 from _bv z where z.ka = b.ka and (z.nop_t = '') <> (b.nop_t = ''));

  select coalesce(jsonb_agg(distinct b.articulo), '[]') into v_dup from _bv b
   where b.articulo <> '' and exists (select 1 from bases x where x.area = p_area and _nk(x.articulo) = b.ka);

  select coalesce(jsonb_agg(jsonb_build_object('articulo', a, 'motivo', m)), '[]') into v_inv from (
    select coalesce(nullif(min(articulo), ''), '(sin código)') a, min(motivo) m
      from _bv b
     where not exists (select 1 from bases x where x.area = p_area and _nk(x.articulo) = b.ka and b.ka <> '')
     group by ka having bool_or(motivo is not null)) z;

  select coalesce(jsonb_agg(articulo), '[]') into v_ok from (
    select min(articulo) articulo from _bv b
     where ka <> ''
       and not exists (select 1 from bases x where x.area = p_area and _nk(x.articulo) = b.ka)
     group by ka having not bool_or(motivo is not null)) z;

  insert into bases (area, prenda, cliente, modulo, articulo, operacion, std, max_op, n_op, subido_por)
  select p_area, nullif(prenda, ''), nullif(cliente, ''), nullif(modulo, ''), articulo, operacion, std_t::numeric,
         count(*) over (partition by ka),
         coalesce(nullif(nop_t, '')::int, (row_number() over (partition by ka order by n))::int),
         o.dni
    from _bv b
   where ka <> '' and (v_ok ? articulo);
  get diagnostics v_filas = row_count;

  for v_art in select jsonb_array_elements_text(v_ok) loop
    perform fn_tickets_cache_refrescar_articulo(p_area, v_art);
  end loop;

  return json_build_object('ok', true, 'creados', v_ok, 'filas', v_filas, 'duplicados', v_dup, 'invalidos', v_inv);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;
grant execute on function public.fn_bases_agregar_varios(text, uuid, text, jsonb) to anon, authenticated;

/* ============================================================
   4. Se retira: Paquetes sueltos, Carga vs capacidad, Resumen de OF
      (fn_avance_of, fn_avance_of_ops y fn_ofs_completar se conservan)
   ============================================================ */
do $$
declare dep text;
begin
  select string_agg(distinct p.proname, ', ') into dep
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname not in ('fn_paquetes_sueltos','fn_paquetes_sueltos_of','_sueltos','_sueltos_areas',
                           'fn_carga_capacidad','fn_ofs_completadas','fn_ofs_completar_varias')
     and p.prosrc ~ '(fn_paquetes_sueltos|fn_carga_capacidad|fn_ofs_completadas|fn_ofs_completar_varias|[^a-z_]_sueltos\(|_sueltos_areas)';
  if dep is not null then
    raise exception 'Otra función todavía usa lo que se quiere borrar: %', dep;
  end if;
end $$;

drop function if exists public.fn_paquetes_sueltos_of(text, uuid, text, text);
drop function if exists public.fn_paquetes_sueltos(text, uuid, text);
drop function if exists public._sueltos_areas(text, uuid, text);
drop function if exists public._sueltos(text[], text);
drop function if exists public.fn_carga_capacidad(text, uuid, text);
drop function if exists public.fn_ofs_completadas(text, uuid, text);
drop function if exists public.fn_ofs_completar_varias(text, uuid, jsonb, boolean);

/* ============================================================
   5. TALLER en la salida de Corte (el programa de costura ya guarda `planta`)
   ============================================================ */
alter table public.pcp_corte add column if not exists taller text;

create or replace function public.fn_pcp_corte_cargar(p_dni text, p_token uuid, p_origen text, p_filas jsonb)
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '20s' as $$
declare o operarios; v_n int; v_d date; v_h date;
begin
  o := _pcp_editor(p_dni, p_token);
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'No hay filas de corte con fecha y cantidad');
  end if;
  if jsonb_array_length(p_filas) > 20000 then
    return json_build_object('ok', false, 'error', 'Máximo 20000 filas por carga: elige un rango de fechas más corto');
  end if;
  select min((x->>'fecha')::date), max((x->>'fecha')::date) into v_d, v_h from jsonb_array_elements(p_filas) x;
  delete from pcp_corte where fecha between v_d and v_h;
  insert into pcp_corte (fecha, o_f, articulo, color, cliente, cantidad, corte_real, taller)
  select (x->>'fecha')::date, nullif(trim(x->>'of'), ''), upper(trim(x->>'articulo')), nullif(trim(x->>'color'), ''),
         nullif(trim(x->>'cliente'), ''), (x->>'cantidad')::numeric, nullif(x->>'corte_real', '')::numeric,
         nullif(upper(trim(x->>'taller')), '')
    from jsonb_array_elements(p_filas) x
   where nullif(x->>'fecha', '') is not null and coalesce(nullif(x->>'cantidad', '')::numeric, 0) <> 0;
  get diagnostics v_n = row_count;
  insert into pcp_cargas (tipo, archivo, filas, desde, hasta, cargado_por, cargado_en)
  values ('CORTE', left(p_origen, 300), v_n, v_d, v_h, o.dni, now())
  on conflict (tipo) do update set archivo = excluded.archivo, filas = excluded.filas, desde = excluded.desde,
    hasta = excluded.hasta, cargado_por = excluded.cargado_por, cargado_en = excluded.cargado_en;
  return json_build_object('ok', true, 'filas', v_n, 'desde', v_d, 'hasta', v_h);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

commit;
