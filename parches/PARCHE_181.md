# Parche 181 — PCP: lo cortado real reemplaza lo programado y el panel de OF carga rápido

**Problema:** Cant prog no reflejaba lo que NOTI_CORTE ya cortó; el panel de OF tardaba más de 3 s (el min/max por área recorría 259 mil reclamos).
**Cambio:** `fn_pcp_costura`: si la OF tiene corte, Cant prog = lo cortado (general para saco y pantalón, repartido por área entre las filas de la OF; devuelve `cant_plan` y `cortado`). `fn_pcp_of_avance`: una sola pasada por los reclamos de la OF y meta de Corte = lo programado. No crea tablas.
**Verificar:** OF 9874: saco 109/134/43/130 y pantalón 109/307 (suman 416). OF 10484: 233. El panel abre en menos de 1 s.
**Deshacer:** `sql/parche_181_rollback.sql`.
