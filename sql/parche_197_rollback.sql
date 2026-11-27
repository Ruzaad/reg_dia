-- Deshace el 197: quita la función (vuelve al estado roto del 196, sin uso útil).
begin;
drop function if exists public.fn_bases_agregar_varios(text, uuid, text, jsonb);
commit;
