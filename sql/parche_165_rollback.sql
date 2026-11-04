-- Deshace el parche 165
begin;
drop function if exists public.fn_pcp_cronos_prendas(text, uuid, date, date);
commit;
