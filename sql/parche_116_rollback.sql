-- Rollback del PARCHE 116 (trabajo por tiempo). Borra las tablas de lotes con
-- lo registrado en ellas: correrlo solo si se decide no usar lotes.
begin;
drop function if exists public.fn_lote_tramo_revisar(text, uuid, bigint, integer, text);
drop function if exists public.fn_lote_detalle(text, uuid, integer);
drop function if exists public.fn_lotes_panel(text, uuid, text, date);
drop function if exists public.fn_lote_cerrar(text, uuid, integer, boolean);
drop function if exists public.fn_lote_crear(text, uuid, text, text, text, integer, text);
drop function if exists public.fn_lote_tareas(text, uuid);
drop function if exists public.fn_lote_terminar(text, uuid, integer);
drop function if exists public.fn_lote_empezar(text, uuid, integer);
drop function if exists public.fn_lotes_mios(text, uuid);
drop function if exists public._lote_json(lotes);
drop function if exists public._lote_permiso(operarios, text, boolean);
drop function if exists public._lote_area_hoy(operarios);
drop function if exists public._lotes_autocierre();
drop function if exists public._tramo_min(timestamptz, timestamptz);
drop table if exists public.lote_tramos;
drop table if exists public.lotes;
drop table if exists public.lote_tareas;
commit;
