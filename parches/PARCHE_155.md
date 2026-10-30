# Parche 155 — Inicio: sin UDP, estructura vs personal disponible, eficiencia del mes anterior y proyección

**Problema:** el Inicio mostraba UDP, no separaba estructura de personal disponible y la proyección usaba el ritmo actual en vez de la eficiencia del mes anterior.

**Cambio:**
- `inicio_mes_cerrado`: minutos por área de cada mes (sembrada con septiembre); `fn_inicio_plan` la actualiza cada día para el mes en curso.
- `fn_inicio_plan` (reemplaza la del 154): sin UDP; devuelve estructura (MOD + MOI), personal disponible (MOD), `disp_total` calculado aparte, horas extra del mes y eficiencia del mes anterior (por área y total).
- Front: proyectado = eficiencia del mes anterior × disponible; tabla con total y error si no suma el 100 %; "qué hacer" abajo con necesario vs actual.

**Verificar:** `select fn_inicio_plan('<dni>', '<token>'::uuid)->>'ef_prev';` devuelve ~0.74 para octubre 2026. Correr después del 154.
