-- PARCHE 174 — PCP limpio: la pantalla ya no usa el resumen ni el seguimiento (solo el calendario por área).
-- Elimina fn_pcp_seguimiento, _pcp_seguimiento y fn_pcp_resumen. NO toca _pcp_prod, _pcp_meta_area (la usa fn_mi_meta) ni las cargas de PCP.
-- Correr DESPUÉS de que el front nuevo esté desplegado (PR fusionado). Rollback: parche_174_rollback.sql
begin;
drop function if exists public.fn_pcp_seguimiento(text, uuid, date);
drop function if exists public._pcp_seguimiento(date, text);
drop function if exists public.fn_pcp_resumen(text, uuid, date);
commit;
