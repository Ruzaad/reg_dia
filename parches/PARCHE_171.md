# Parche 171 — PCP seguimiento rápido

**Problema:** la pestaña PCP no mostraba gráficos ni Gantt y salía «sistema ocupado». `fn_pcp_seguimiento` tardaba ~20 s (falla en 5 de 6 llamadas) porque, por cada OF del cronograma, buscaba su costura recorriendo ~114 000 reclamos por fecha.

**Cambio:** `_pcp_seguimiento` calcula inicio y minutos de costura en una sola consulta por OF que usa el índice `reclamos_of_activo`. Mismo resultado, sin tablas ni índices nuevos. Medido: 25.7 s → 0.1 s en esa parte.

**Verificar:** `select (fn_pcp_seguimiento(...))` o abrir PCP: gráficos y Gantt cargan en pocos segundos.

**Deshacer:** `sql/parche_171_rollback.sql`.
