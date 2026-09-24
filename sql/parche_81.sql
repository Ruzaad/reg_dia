-- PARCHE 81 — Limpieza de la base: permisos, funciones sin uso e índices
--
-- Cierra el hueco de permisos del parche 62 (tres funciones internas quedaron
-- ejecutables por `anon`, una de ellas borra el almacén de un área entera),
-- da de baja siete funciones que ya nadie llama —entre ellas fn_tickets_area,
-- la que causó el incidente del 11-set documentado en el parche 67— y retira
-- dos índices que ya no aportan.
--
-- Las siete funciones cumplen las tres condiciones a la vez: cero llamadas por
-- REST en la ventana que las cubre, ninguna otra función las llama (búsqueda en
-- el cuerpo de las otras 136) y cero menciones en app.js, ingenieria.js y los
-- .html. La vuelta atrás está en `sql/parche_81_rollback.sql`, con la definición
-- exacta de las siete sacada de producción antes de borrarlas.
--
-- ES OBLIGATORIO EJECUTARLO EN DOS PARTES: la parte 2 usa CONCURRENTLY, que no
-- corre dentro de una transacción. No pegues todo el archivo de una vez.

-- ===========================================================================
-- PARTE 1 — En cualquier momento. Sí va dentro de una transacción.
-- ===========================================================================
begin;

-- A1 · Los tres internos dejan de ser alcanzables desde la clave pública.
-- No piden DNI ni token; fn_tickets_cache_refrescar hace
-- `delete from tickets_cache where area = p_area`. Ninguna se llamó por REST
-- en 74 días (pg_stat_statements desde el 10-jul, dealloc = 0). Por dentro las
-- siguen usando 8, 3 y 2 funciones: eso no pasa por este permiso.
revoke execute on function public.fn_tickets_cache_refrescar(text, text)
  from anon, authenticated;
revoke execute on function public.fn_tickets_cache_refrescar_articulo(text, text)
  from anon, authenticated;
revoke execute on function public.fn_tickets_of_raw(text, text)
  from anon, authenticated;

-- B1 · fn_tickets_area: la reemplazó fn_tickets_of en el parche 67.
-- Cero llamadas desde el 15-set (los logs ven los tres despliegues a la vez,
-- porque todos apuntan a esta misma base). 46% del CPU de la base desde julio.
-- Si prefieres un paso reversible en segundos, comenta el drop y descomenta
-- el revoke: deja la función viva pero inalcanzable desde el frontend.
drop function if exists public.fn_tickets_area(text, uuid, text);
-- revoke execute on function public.fn_tickets_area(text, uuid, text)
--   from anon, authenticated;

-- B2 · fn_asistencia_dia: 22 llamadas en 74 días, la última en julio.
-- Hoy la asistencia la mueven fn_asistencia_marcar_lista y ..._marcar_guardar.
drop function if exists public.fn_asistencia_dia(text, uuid, date);

-- B3 · fn_asistencia_mes: 672 llamadas desde el 11-jul, ninguna en setiembre.
-- La reemplazó fn_asistencia_matriz, que sí se llama casi a diario.
-- Nota: es la única de las siete que se usó de verdad en su momento, y en 22
-- días no hubo un cierre de mes. Si algo se echa en falta el 30, está en el
-- rollback.
drop function if exists public.fn_asistencia_mes(text, text, text, integer, integer);

-- B4 · fn_marcar_asistencia: 4 llamadas en 74 días, la última el 11-jul.
-- La reemplazó fn_asistencia_marcar_guardar.
drop function if exists public.fn_marcar_asistencia(text, uuid, text[], text, date);

-- B5 · fn_liberar_registro: cero llamadas en 74 días. Nunca estuvo en el
-- frontend (revisado en todo el historial de git). Hoy se libera con
-- fn_liberar_ticket y fn_liberar_ids.
drop function if exists public.fn_liberar_registro(text, uuid, bigint, text);

-- B6 · fn_min_incidencia: cero llamadas en 74 días. Auxiliar huérfana: ninguna
-- función la llama. La reemplazó _min_salida.
drop function if exists public.fn_min_incidencia(text, integer, time without time zone,
                                                 time without time zone, boolean, numeric);

-- C · fn_asignar_tickets: dada de baja por decisión de Ruzaad (22-set) — ya no
-- se usa para nada. Salió del frontend en el parche 75. Los logs le ven 3
-- llamadas el 11-set (2 con error 500 y 1 con 200) y pg_stat_statements
-- ninguna; queda anotado por si alguien busca la diferencia más adelante.
drop function if exists public.fn_asignar_tickets(text, uuid, text, text, text[]);

commit;

-- ===========================================================================
-- PARTE 2 — Fuera de turno. CADA SENTENCIA POR SEPARADO, sin begin/commit.
-- CONCURRENTLY no bloquea lecturas ni escrituras, pero tarda más y usa disco
-- extra mientras trabaja. Si alguna falla, deja un índice inválido: búscalo con
--   select indexrelid::regclass from pg_index where not indisvalid;
-- y bórralo antes de reintentar.
-- ===========================================================================

-- A2 · reclamos_motivo_fecha_idx: cero usos desde el 30-jun. Además se paga en
-- cada update de reclamos, y van 1.25 millones.
drop index concurrently if exists public.reclamos_motivo_fecha_idx;

-- A3 · tickets_cache_area_idx: lo creó el parche 62; el parche 67 añadió
-- tickets_cache_area_of_idx (area, o_f, n_op, paq), que lo cubre por prefijo.
-- Nadie retiró el viejo. Se paga en las 850 000 inserciones del refresco.
drop index concurrently if exists public.tickets_cache_area_idx;

-- A4 · Higiene de tickets_cache. NO borra ninguna fila: reescribe los índices
-- a partir de las filas que ya existen. La tabla acumula ~817 000 borrados
-- desde julio (el refresco por área es delete + insert), y hoy arrastra ~28 700
-- filas muertas con 26 MB de índices para 146 000 filas.
reindex index concurrently public.tickets_cache_pkey;
reindex index concurrently public.tickets_cache_area_of_idx;

-- ===========================================================================
-- COMPROBACIÓN — después de las dos partes
-- ===========================================================================
-- select indexrelid::regclass, indisvalid from pg_index
--  where indrelid = 'public.tickets_cache'::regclass;
--
-- select pg_size_pretty(pg_total_relation_size('public.tickets_cache')) cache,
--        pg_size_pretty(pg_total_relation_size('public.reclamos')) reclamos,
--        pg_size_pretty(pg_database_size(current_database())) total;
--
-- Las siete deben devolver 0 filas:
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and proname in ('fn_tickets_area','fn_asistencia_dia','fn_asistencia_mes',
--                    'fn_marcar_asistencia','fn_liberar_registro',
--                    'fn_min_incidencia','fn_asignar_tickets');
--
-- Y los tres internos deben quedar sin anon ni authenticated:
-- select p.proname, a.grantee::regrole::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   cross join lateral aclexplode(p.proacl) a
--  where n.nspname = 'public' and a.privilege_type = 'EXECUTE'
--    and p.proname in ('fn_tickets_cache_refrescar',
--                      'fn_tickets_cache_refrescar_articulo','fn_tickets_of_raw');
