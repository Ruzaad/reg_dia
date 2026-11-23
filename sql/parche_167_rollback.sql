begin;
drop function if exists public.fn_bon_corte_cargar(text, uuid, date, date, jsonb, boolean);
drop function if exists public._bon_corte_aplicar(date, date, jsonb, text, boolean);
commit;
