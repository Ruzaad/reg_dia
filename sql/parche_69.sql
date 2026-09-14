-- PARCHE 69 — Bases: guardar varias operaciones de una sola vez
--
-- POR QUÉ
--   Corregir el mismo STD en varios artículos (filtrar por una operación y tocar
--   las 15 filas que salen) obligaba a abrir el modal 15 veces. Cada guardado
--   dispara además una resecuencia, una propagación a `reclamos` y un refresco de
--   `tickets_cache`, así que el coste no era solo el de los clics.
--
-- QUÉ HACE
--   Recibe todos los cambios en un jsonb y los aplica en UNA transacción, con una
--   sola resecuencia y una sola sincronización POR ARTÍCULO al final. Por fila, 15
--   cambios del mismo artículo lo renumerarían 15 veces.
--
-- ATOMICIDAD
--   Las validaciones se levantan con `raise`, NO con `return`: el bloque EXCEPTION
--   de plpgsql es una subtransacción, así que salir por ahí deshace las filas ya
--   actualizadas. Con un `return` a media pasada el lote quedaría escrito a medias.
--   Comprobado en producción: un lote con la segunda fila inválida no dejó tocada
--   la primera.
--
-- LO QUE NO CAMBIA
--   `fn_base_op_editar` (una fila, desde el modal) se queda igual y se sigue usando.
--   `max_op` tampoco se acepta aquí: lo recalcula `_base_resecuenciar` a partir del
--   número de operaciones del artículo, igual que en la edición de una fila.

create or replace function public.fn_base_ops_editar_lote(p_dni text, p_token text, p_cambios jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare
  c jsonb; k text;
  v_id bigint; v_area text; v_art_old text; v_art text;
  v_filas int := 0; v_prop int := 0;
  v_arts text[] := '{}';   -- claves "area<TAB>articulo" tocadas
begin
  perform fn_validar_ingenieria(p_dni, p_token);

  if p_cambios is null or jsonb_typeof(p_cambios) <> 'array'
     or jsonb_array_length(p_cambios) = 0 then
    return json_build_object('ok', false, 'error', 'Sin cambios que guardar');
  end if;

  /* Los errores de validación se levantan como excepción, NO con un return: el
     bloque EXCEPTION es una subtransacción, así que salir por ahí deshace las
     filas ya actualizadas. Con un return se guardarían a medias. */
  for c in select * from jsonb_array_elements(p_cambios) loop
    v_id := (c->>'id')::bigint;

    if coalesce(trim(c->>'articulo'),'') = '' or coalesce(trim(c->>'operacion'),'') = '' then
      raise exception 'LOTE: artículo y operación son obligatorios (fila id %)', v_id;
    end if;

    select area, upper(trim(articulo)) into v_area, v_art_old from bases where id = v_id;
    if not found then
      raise exception 'LOTE: ya no existe la fila id %; recarga la base', v_id;
    end if;

    v_art := upper(trim(c->>'articulo'));
    update bases set
      prenda    = c->>'prenda',
      cliente   = c->>'cliente',
      modulo    = c->>'modulo',
      articulo  = v_art,
      operacion = c->>'operacion',
      std       = coalesce((c->>'std')::numeric, 0),
      n_op      = coalesce(nullif((c->>'n_op')::int, 0), 999999)
    where id = v_id;

    v_filas := v_filas + 1;
    v_arts  := v_arts || (v_area || E'\t' || v_art);
    if v_art_old <> v_art then v_arts := v_arts || (v_area || E'\t' || v_art_old); end if;
  end loop;

  /* Una sola resecuencia y una sola sincronización POR ARTÍCULO, al final: por
     fila, 15 cambios del mismo artículo lo renumerarían 15 veces. Sin p_prio,
     porque en un lote no hay una fila privilegiada: `_base_resecuenciar`
     desempata por id, que es estable. */
  select coalesce(array_agg(distinct x), '{}') into v_arts from unnest(v_arts) x;
  foreach k in array v_arts loop
    v_area := split_part(k, E'\t', 1);
    v_art  := split_part(k, E'\t', 2);
    perform _base_resecuenciar(v_area, v_art, NULL);
    v_prop := v_prop + _sync_reclamos_articulo(v_area, v_art);
    perform fn_tickets_cache_refrescar_articulo(v_area, v_art);
  end loop;

  return json_build_object(
    'ok', true,
    'filas', v_filas,
    'reclamos_actualizados', v_prop,
    'articulos', (select coalesce(array_agg(distinct split_part(x, E'\t', 2)), '{}')
                    from unnest(v_arts) x));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', replace(SQLERRM, 'LOTE: ', ''));
end $function$;

notify pgrst, 'reload schema';
