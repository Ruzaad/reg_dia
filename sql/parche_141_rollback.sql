-- Deshacer parche 141. Antes devuelve las cantidades descontadas desde reproceso_lote_ajuste.
-- Los nombres de lote y topes cambiados NO se revierten solos: están en reproceso_lote_cambios.
begin;
update public.reclamos r set cant = a.cant_antes
  from (select distinct on (reclamo_id) reclamo_id, cant_antes from public.reproceso_lote_ajuste order by reclamo_id, id) a
 where r.id = a.reclamo_id;
drop function if exists public.fn_reproceso_lote_editar(text, uuid, text, text, integer, boolean);
drop table if exists public.reproceso_lote_ajuste;
drop table if exists public.reproceso_lote_cambios;
commit;
