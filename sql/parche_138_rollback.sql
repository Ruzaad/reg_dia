-- Deshace el parche 138: quita fn_costos_reporte_dia (fn_costos_reporte no se tocó).
begin;
drop function if exists public.fn_costos_reporte_dia(text, uuid, date, text);
commit;
