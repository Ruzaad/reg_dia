# Parche 183 — Bonificación: REPROCESO sin eficiencia toma la de su modular

**Problema:** REPROCESO no tiene tickets de eficiencia y sus días salían NO ENTREGO (anulan la quincena).
**Cambio:** `fn_incentivos_quincena` (misma firma). Igual que CORTE (parche 168), el día laborable sin ausencia ni eficiencia manual toma el % del bono modular de REPROCESO de ese día. Incluye lo del parche 182 (apoyo sin ticket), así que sirve corrido o no el 182. Solo bonificaciones, sin tablas.
**Verificar:** 1–15 nov, REPROCESO: boletas de 10 a 2 en quienes no reclaman tickets. Quedan los días sin modular cargado (12 y 13 nov).
**Deshacer:** `sql/parche_183_rollback.sql` (vuelve al 182).
