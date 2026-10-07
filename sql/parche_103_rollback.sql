-- PARCHE 103 · vuelta atrás. Borra el tablero de boletas sin llenar y sus avisos.
begin;
drop function if exists public.fn_boleta_avisar(text, uuid, text, date, boolean);
drop function if exists public.fn_boletas_sin_llenar(text, uuid, date, text);
drop function if exists public._boletas_areas(text, uuid, text);
drop function if exists public._boleta_estados(text[], date, date);
drop table if exists public.boletas_avisos;
delete from permisos_pestana where pestana = 'pasoBolSin';
commit;
