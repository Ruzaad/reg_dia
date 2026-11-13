-- Rollback del parche 180
begin;
drop function if exists public.fn_pcp_of_avance(text, uuid, text);
commit;
