# Parche 174 — PCP limpio

**Problema:** bajo el calendario de PCP quedaban tablas, gráficos y un Gantt que ya no se usan, y dos consultas pesadas (`fn_pcp_resumen`, `fn_pcp_seguimiento`) que se cortaban por tiempo.

**Cambio:** la pantalla de PCP muestra los medidores arriba, luego el calendario por área; se retira lo demás. Se eliminan `fn_pcp_seguimiento`, `_pcp_seguimiento` y `fn_pcp_resumen`. Siguen las cargas (programa, corte, cronograma PDF).

**Orden:** primero el front desplegado, luego este SQL.

**Deshacer:** `sql/parche_174_rollback.sql`.
