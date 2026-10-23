-- Deshacer parche 142. Un lote ya eliminado no vuelve solo: sus datos quedaron en reproceso_lote_cambios
-- (nombre y cantidad); se recrea desde Crear lote.
begin;
drop function if exists public.fn_reproceso_lote_eliminar(text, uuid, text);
commit;
