# PARCHE 187 — PCP: columnas Corte, Costura y Acabado con detalle por módulo

**Problema:** el cronograma de PCP mostraba un solo Status (costura) y la línea de tiempo al tocar la OF.

**Cambio (solo lectura, sin tablas):**
- `fn_pcp_etapas(dni, token, mes)`: % de Corte y de Acabado de todas las OF del mes en una sola consulta (≈1,4 s con datos reales). Costura sigue saliendo de `fn_pcp_costura.status`.
- `fn_pcp_etapa_detalle(dni, token, of, etapa, area)`: módulos y operaciones (inicio, final, prendas) de una etapa; se pide solo al tocar el % (≈0,35 s). El % usa la penúltima operación. Corte aún no tiene módulos y se muestra por fecha de salida.
- Front: se quita el panel lateral de la OF (`fn_pcp_of_avance` queda en la base, sin uso); el modal reutiliza `.modal-overlay` y las clases de Buscar y Seguir.

**Verificar:** en PCP › Cronograma aparecen Corte, Costura y Acabado; tocar un % abre el detalle.
**Deshacer:** `sql/parche_187_rollback.sql`.
