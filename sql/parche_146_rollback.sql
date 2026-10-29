-- ROLLBACK PARCHE 146 — quita el cronograma de corte, el seguimiento y el endpoint de PCP.
begin;
drop function if exists public.fn_pcp_api_clave_revocar(text, uuid, bigint);
drop function if exists public.fn_pcp_api_claves(text, uuid);
drop function if exists public.fn_pcp_api_clave_crear(text, uuid, text);
drop function if exists public.fn_pcp_api(text, date, text);
drop function if exists public.fn_pcp_seguimiento(text, uuid, date);
drop function if exists public._pcp_seguimiento(date, text);
drop function if exists public.fn_pcp_cronograma_cargar(text, uuid, text, jsonb);
drop table if exists public.pcp_api_claves;
drop table if exists public.pcp_cronograma;
delete from public.pcp_cargas where tipo = 'CRONOGRAMA';
alter table public.pcp_cargas drop constraint if exists pcp_cargas_tipo_check;
alter table public.pcp_cargas add constraint pcp_cargas_tipo_check check (tipo in ('PROGRAMA','CORTE'));
commit;
