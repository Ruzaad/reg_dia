-- Rollback del parche 112: quita las dos funciones. Las horas extra ya
-- registradas se quedan (son ocurrencias normales).
begin;
drop function if exists public.fn_sup_horas_extra(text, uuid, date, numeric, text[]);
drop function if exists public.fn_sup_he_lista(text, uuid, text, date);
commit;
