-- ROLLBACK PARCHE 144 — PCP. Borra las tablas y funciones nuevas; metas_mes (parche 130) se queda,
-- solo se borran las metas que cargó PCP (CORPORACION y AREA).
begin;
drop function if exists public.fn_mi_meta(text, uuid);
drop function if exists public.fn_pcp_corte_cargar(text, uuid, text, jsonb);
drop function if exists public.fn_pcp_programa_cargar(text, uuid, text, jsonb);
drop function if exists public.fn_pcp_meta_guardar(text, uuid, date, jsonb);
drop function if exists public.fn_pcp_resumen(text, uuid, date);
drop function if exists public._pcp_meta_area(text, date);
drop function if exists public._pcp_editor(text, uuid);
drop table if exists public.pcp_corte;
drop table if exists public.pcp_programa;
drop table if exists public.pcp_cargas;
delete from public.metas_mes where alcance in ('CORPORACION','AREA');
commit;
