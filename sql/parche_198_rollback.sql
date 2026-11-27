-- Deshace el parche 198
begin;
drop function if exists public.fn_estructura_candidatos(text, text, date, text);
drop function if exists public.fn_estructura_agregar(text, text, date, text, text, text, text, text, date, text);
commit;
