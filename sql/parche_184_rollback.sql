-- Rollback del parche 184: quita el reconocimiento por quincena.
begin;
drop function if exists public.fn_mi_reconocimiento(text, uuid);
drop function if exists public.fn_reconocimientos(text, uuid, date);
drop function if exists public.fn_reconocimiento_publicar(text, uuid, date, date, json);
drop table if exists public.reconocimientos;
commit;
