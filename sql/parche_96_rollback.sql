-- ROLLBACK del PARCHE 96: quita las cuatro RPC de lectura de Costos.
-- No toca datos (el parche solo lee).
begin;
drop function if exists public.fn_costos_base(text, uuid, text);
drop function if exists public.fn_costos_reporte(text, uuid, date, text);
drop function if exists public.fn_costos_incidencias(text, uuid, text, date, date);
drop function if exists public.fn_costos_asistencia(text, uuid, text, date);
commit;
