-- ROLLBACK PARCHE 148
begin;
drop function if exists public.fn_inicio_prendas(text, uuid, date);
commit;
