begin;
drop function if exists public.fn_inicio_plan(text, uuid, date);
drop function if exists public.fn_corte_manual_guardar(text, uuid, date, numeric, numeric);
drop table if exists public.corte_manual;
commit;
