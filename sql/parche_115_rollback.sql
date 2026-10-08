-- Rollback del parche 115: quita las funciones de paquetes sueltos (no toca datos).
begin;
drop function if exists public.fn_paquetes_sueltos_of(text, uuid, text, text);
drop function if exists public.fn_paquetes_sueltos(text, uuid, text);
drop function if exists public._sueltos(text[], text);
drop function if exists public._sueltos_areas(text, uuid, text);
drop function if exists public._dias_hab(date, date);
commit;
