begin;
drop function if exists public.fn_pcp_etapas(text, uuid, date);
drop function if exists public.fn_pcp_etapa_detalle(text, uuid, text, text, text);
commit;
