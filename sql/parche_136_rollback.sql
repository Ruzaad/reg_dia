-- Deshace el parche 136. Lo ya reclasificado se conserva (cada talla queda como fila suelta).
begin;
drop function if exists public.fn_reproceso_reclasif_info2(text, uuid, text);
drop function if exists public.fn_reproceso_reclasificar_varias(text, uuid, text, text, text, jsonb);
drop function if exists public.fn_reproceso_reclasif_anular_tanda(text, uuid, text);
drop index if exists public.reproceso_reclasif_tanda;
alter table public.reproceso_reclasif drop column if exists tanda;
commit;
