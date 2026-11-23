# Parche 180 — PCP: avance de una OF de Corte a Acabado

**Problema:** el cronograma no muestra en qué etapa va una OF.
**Cambio:** `fn_pcp_of_avance(dni, token, of)` (lectura): corte (cronograma PDF y NOTI_CORTE), costura por área (penúltima operación) y Acabado, en prendas. No toca tablas ni funciones existentes.
**Verificar:** en el cronograma, tocar una OF abre el panel lateral con las etapas. Mide ~1 s (igual que `fn_pcp_costura`).
**Deshacer:** `sql/parche_180_rollback.sql`.
