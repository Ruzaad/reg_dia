# Parche 146 · PCP: cronograma de corte, seguimiento y endpoint

**Problema.** PCP necesita medir si se cumple su cronograma (corte y costura), ver el compromiso semanal contra la demanda, el minutaje y la eficiencia diaria, y consultar todo eso desde otro sistema.

**Cambio.**
- `pcp_cronograma`: el PDF «Cronograma de Corte» que sube PCP (se lee en el navegador, solo la versión vigente). Las filas «SIN OF» se cruzan por artículo.
- `_pcp_seguimiento(mes, OF)`: cumplimiento del cronograma (corte contra NOTI_CORTE, inicio de costura contra el primer ticket de costura de la OF), Gantt por OF de lo que arranca costura sin corte completo, minutaje semanal (meta, programa por fin de costura y real) y minutaje/eficiencia diaria (disponible = MOD de la estructura × jornada).
- `fn_pcp_seguimiento` (pantalla PCP, con sesión) y `fn_pcp_api(p_clave, p_mes, p_of)` (endpoint con clave propia, solo hash guardado, revocable). Claves: `fn_pcp_api_clave_crear`, `fn_pcp_api_claves`, `fn_pcp_api_clave_revocar`.
- Front: `pcp-seguimiento.js` (Gantt, gráficos con leyenda, PDF con pdf.js cargado solo al subir el cronograma) y estilos en `rediseno.css`.

**Cómo verificar.** Ingeniería › PCP › «Subir cronograma de corte (PDF)» (debe decir «Cronograma subido: N órdenes»); revisar Cumplimiento, Gantt, semanal y diario; crear una clave y probar el `curl` que muestra la pantalla.

**Deshacer.** `sql/parche_146_rollback.sql`.
