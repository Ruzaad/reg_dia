-- Rollback del parche 121: quita la consulta de Calidad de BASES (no toca datos).
begin;
drop function if exists public.fn_bases_calidad(text, uuid);
commit;
