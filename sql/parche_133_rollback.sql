-- ROLLBACK parche 133: quita la estructura por mes (borra sus datos).
begin;
drop trigger if exists estructura_sync_trg on public.operarios;
drop function if exists public._estructura_sync();
drop function if exists public.fn_estructura_mes(text, uuid, date, text);
drop function if exists public.fn_estructura_guardar(text, text, date, text, text, text, text, text, text, date, date, text);
drop function if exists public.fn_estructura_quitar(text, text, date, text);
drop function if exists public.fn_estructura_copiar(text, text, date);
drop table if exists public.estructura_mes;
commit;
