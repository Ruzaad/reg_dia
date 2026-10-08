-- Rollback del parche 106: quita las funciones de búsqueda y los índices.
begin;
drop function if exists public.fn_traza_persona(text, uuid, text);
drop function if exists public.fn_traza_of(text, uuid, text);
drop function if exists public.fn_traza_paquete(text, uuid, text, int);
drop function if exists public.fn_buscar(text, uuid, text);
drop function if exists public._traza_regs(text, text);
drop function if exists public._buscar_areas(operarios);
drop index if exists public.reclamos_area_codigo_idx;
drop index if exists public.reclamos_of_idx;
drop index if exists public.reclamos_dni_fecha_idx;
drop index if exists public.tickets_cache_of_idx;
drop index if exists public.tickets_cambios_det_fila_idx;
commit;
