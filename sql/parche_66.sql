-- PARCHE 66 — Repara timeouts reales encontrados en auditoría (fn_asignar_tickets
-- reportado por el usuario + barrido de logs que encontró 3 más)
--
-- Confirmado en logs de las últimas horas (canceling statement due to statement
-- timeout), TODOS con el mismo patrón de fondo: recalcular algo caro dentro de
-- una función sin aprovechar tickets_cache (parche 62/65), o iterar en loop una
-- cantidad grande de filas:
--
--   fn_asignar_tickets  — 2 fallos ~3.2-3.4s (reportado por el usuario)
--   fn_tickets_libres   — mismo patrón (no falló aún en logs, pero tiene el
--                         mismo bug: si se busca sin OF ni artículo, recalcula
--                         fn_tickets_of_raw(area, null) entero)
--   fn_liberar_ids      — 2 fallos ~3.2-3.4s al liberar un LOTE grande de
--                         tickets de una vez (content-length 5352 vs ~250 de
--                         los que sí pasan)
--   fn_tickets_area     — 4 fallos ~3.7-3.9s: este NO es un bug de SQL — la
--                         función ya lee de tickets_cache (~60ms de cómputo),
--                         pero el JSON de salida pesa 7-15MB según el área, y
--                         ESO es lo que tarda en viajar por red. Ningún ajuste
--                         de statement_timeout lo arregla: la solución es la
--                         carga por-OF que se está diseñando (punto 1).
--   fn_reclamar         — 1 fallo aislado (504, 7.3s). Su lógica ya es liviana
--                         e indexada; no se toca. Probablemente colateral de
--                         la carga pesada de fn_tickets_area corriendo en
--                         paralelo. Queda en observación.
--
-- Fix en este parche:
--   1) fn_asignar_tickets y fn_tickets_libres: leen de tickets_cache en vez de
--      recalcular fn_tickets_of_raw(area, null) sin filtro.
--   2) fn_liberar_ids: se le agrega SET statement_timeout TO '30s' como
--      colchón (es una acción de ingeniería, ocasional, no de alto tráfico).
--      No se reescribió su loop interno (llama a _deshacer_troceo, que tiene
--      lógica condicional por ticket) — si en el futuro los lotes siguen
--      siendo grandes y 30s no alcanza, el siguiente paso es volverla
--      set-based en vez de por-código.
--   3) Se elimina el overload viejo fn_tickets_cache_refrescar(text) de un
--      solo argumento: quedó huérfano del parche 65 (CREATE OR REPLACE con un
--      parámetro nuevo NO reemplaza la firma vieja, crea una firma aparte) y
--      es ambiguo para PostgREST/SQL si algo lo llama con un solo argumento —
--      podía terminar ejecutando otra vez la versión lenta sin que se notara.

create or replace function public.fn_asignar_tickets(p_dni text, p_token uuid, p_area text, p_dni_op text, p_codigos text[])
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare s operarios; t record; n int := 0;
        v_omit text[] := '{}'; v_est text;
begin
  s := _ing(p_dni, p_token);
  if not exists (select 1 from operarios
                  where dni = p_dni_op and cargo in ('OPERARIO','ESTAJERO') and estado = 'ACTIVO') then
    return json_build_object('ok', false, 'error', 'Esa persona no está activa');
  end if;
  if p_codigos is null or array_length(p_codigos,1) is null then
    return json_build_object('ok', false, 'error', 'No hay tickets seleccionados');
  end if;
  v_est := _ausente_en(p_dni_op, _hoy());
  if v_est is not null then
    return json_build_object('ok', false, 'error',
      'Hoy esa persona está como '||v_est||': no se le pueden asignar tickets.');
  end if;

  perform set_config('samitex.asignando', 'on', true);

  for t in
    select * from tickets_cache x
    where x.area = p_area and x.codigo = any(p_codigos)
  loop
    if _modulo_cerrado(p_area, t.o_f, t.modulo) then
      v_omit := v_omit || (t.codigo||' (módulo cerrado)');
      continue;
    end if;
    begin
      insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant,
                            cant_asignada, numeracion, articulo, talla, color, corte, nop)
      values (t.codigo, p_dni_op, p_area, t.o_f, t.modulo, t.op, t.std, t.cant,
              t.cant, t.desde::text||'-'||t.hasta::text, t.articulo,
              t.talla, t.color, t.paq::text, t.n_op);
      n := n + 1;
    exception when unique_violation then
      v_omit := v_omit || (t.codigo||' (ya estaba tomado)');
    end;
  end loop;

  if n = 0 then
    return json_build_object('ok', false, 'omitidos', to_json(v_omit),
      'error', 'No se pudo asignar ninguno de los tickets seleccionados.');
  end if;
  return json_build_object('ok', true, 'asignados', n,
    'omitidos', to_json(v_omit), 'omitidos_n', coalesce(array_length(v_omit,1),0));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_tickets_libres(p_dni text, p_token uuid, p_area text, p_of text, p_articulo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v json; v_of text;
begin
  perform _ing(p_dni, p_token);
  if coalesce(trim(p_area),'') = '' then
    return json_build_object('ok', false, 'error', 'Elige el área');
  end if;
  v_of := nullif(trim(p_of),'');

  with libres as (
    select t.*
    from tickets_cache t
    where t.area = p_area
      and (v_of is null or t.o_f = v_of)
      and (coalesce(trim(p_articulo),'') = '' or _nk(t.articulo) = _nk(p_articulo))
      and not exists (select 1 from reclamos r
                       where r.area = p_area and r.codigo = t.codigo
                         and r.estado = 'ACTIVO')
  )
  select json_build_object('ok', true,
    'items', coalesce((
      select json_agg(json_build_object(
          'codigo', l.codigo, 'of', l.o_f, 'articulo', l.articulo,
          'modulo', l.modulo, 'op', l.op, 'nop', l.n_op, 'op_id', l.op_id,
          'std', l.std, 'cant', l.cant, 'minutos', round(l.std * l.cant, 1),
          'talla', l.talla, 'color', l.color, 'corte', l.paq::text,
          'num', l.desde::text || '-' || l.hasta::text,
          'cerrado', exists (select 1 from modulos_cerrados mc
                              where mc.area = p_area
                                and _nk(mc.o_f) = _nk(l.o_f)
                                and _nk(mc.modulo) = _nk(l.modulo)))
          order by l.o_f, l.modulo, l.n_op, l.paq)
        from libres l), '[]'::json),
    'resumen', coalesce((
      select json_agg(json_build_object(
          'modulo', z.modulo, 'op', z.op, 'nop', z.nop,
          'tickets', z.tickets, 'cant', z.cant, 'minutos', z.minutos)
          order by z.modulo, z.nop)
        from (select l.modulo, l.op, l.n_op nop, count(*) tickets,
                     round(sum(l.cant),2) cant, round(sum(l.std*l.cant),1) minutos
              from libres l group by 1,2,3) z), '[]'::json)) into v;
  return v;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_liberar_ids(p_dni text, p_token text, p_ids bigint[], p_motivo text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare r record; v_tro json; v_n int := 0; v_k int; v_av json[] := '{}';
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if p_ids is null or array_length(p_ids,1) is null then
    return json_build_object('ok', false, 'error', 'No hay tickets seleccionados'); end if;

  for r in select id, area, codigo from reclamos
            where id = any(p_ids) and estado = 'ACTIVO' order by id loop
    if r.codigo is not null then
      v_tro := _deshacer_troceo(r.area, r.codigo, p_motivo);
      if json_array_length(v_tro->'anulados') > 0 then
        v_av := v_av || json_build_object('codigo', r.codigo,
          'anulados', v_tro->'anulados', 'liberados', v_tro->'liberados');
      end if;
    end if;
    update reclamos
       set estado = 'LIBERADO',
           motivo_liberacion = coalesce(nullif(trim(p_motivo), ''), 'Liberado por ingeniería')
     where id = r.id and estado = 'ACTIVO';
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;

  if v_n = 0 then
    return json_build_object('ok', false, 'error', 'No hay reclamos activos en la selección'); end if;
  return json_build_object('ok', true, 'liberados', v_n,
    'troceos_deshechos', to_json(v_av));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

drop function if exists public.fn_tickets_cache_refrescar(text);
