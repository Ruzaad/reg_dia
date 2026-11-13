-- PARCHE 179 — PCP: retira lo que solo servía al calendario (reemplazado por el cronograma de costura, parche 178).
-- Se quitan: fn_pcp_calendario, fn_pcp_calendario_areas, fn_pcp_dia_cambiar y _habil (solo los usaban entre sí).
-- NO se toca la tabla dias_habilitados (tiene los días que se habilitaron) ni metas_mes / fn_pcp_meta_* (las usa el Inicio).
-- Correr DESPUÉS de que Vercel sirva el front nuevo y de haber corrido el 178. Rollback: parche_179_rollback.sql
begin;

drop function if exists public.fn_pcp_calendario(text, uuid, date);
drop function if exists public.fn_pcp_calendario_areas(text, uuid, date);
drop function if exists public.fn_pcp_dia_cambiar(text, uuid, date, boolean, text);
drop function if exists public._habil(date);

commit;
