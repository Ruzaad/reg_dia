-- Deshace el parche 128. Borra lo anotado en la reclasificación.
begin;
drop function if exists public.fn_reproceso_reclasif_anular(text, uuid, bigint);
drop function if exists public.fn_reproceso_reclasificar(text, uuid, text, text, text, text, integer);
drop function if exists public.fn_reproceso_reclasif_info(text, uuid, text);
drop function if exists public._reclasif_permiso(operarios);
drop table if exists public.reproceso_reclasif;
commit;
