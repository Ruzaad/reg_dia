# Parche 169 — Incidencias por área de estructura

**Problema:** las incidencias por aprobar se agrupaban por el área con que se pidieron (área actual de la persona), no por la de la estructura del mes.

**Cambio:** `fn_solicitudes_panel` (misma firma) agrega `area_est` = área en `estructura_mes` del mes de la incidencia. El front agrupa y filtra por `area_est` (si no hay estructura usa `area`). Permisos y filtros de visibilidad siguen por `area`. Front viejo sigue funcionando.

**Verificar:** `select fn_solicitudes_panel('<dni>','<token>'::uuid,'',0);` → cada item trae `area_est`.

**Deshacer:** `sql/parche_169_rollback.sql`.
