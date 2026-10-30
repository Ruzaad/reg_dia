# Parche 154 — Inicio: plan del mes por área y corte a mano

**Problema:** el Inicio no decía si se llega a la meta del mes ni cuánto debe rendir cada área, y CORTE no registra producción en el sistema.

**Cambio:**
- `fn_inicio_plan`: por área, disponible del mes = MOD de la estructura × jornada × días laborables, menos días de VACACIONES y LICENCIA. Producido = minutos (penúltima operación) hasta el día anterior + corte a mano. UDP se devuelve con `cuenta=false` y no suma.
- `corte_manual` + `fn_corte_manual_guardar`: Ingeniería pone prendas y minutos de CORTE por día.
- Front: eficiencia meta = meta ÷ disponible total; óptima del área = su disponible × eficiencia meta; proyección con la eficiencia real; qué hacer si no se llega. Áreas en orden Corte, Costura, Acabado, Reproceso.

**Verificar:** `select fn_inicio_plan('<dni>', '<token>'::uuid);` devuelve `ok:true` con las áreas.
