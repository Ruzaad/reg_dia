-- ROLLBACK PARCHE 162 — quita la última / penúltima por prenda y el reporte
-- de Cantidad por área con la penúltima. _ultimas, ultimas_articulo y
-- fn_cantidad_areas no se tocaron en el 162.
begin;
drop function if exists public.fn_cantidad_penultima(text, uuid, date, date);
drop function if exists public.fn_ultimas_prenda_guardar(text, uuid, text, text, text, integer, integer);
drop function if exists public.fn_ultimas_prenda_area(text, uuid, text);
drop function if exists public._ultimas_por_prenda(text);
drop table if exists public.ultimas_prenda;
commit;
