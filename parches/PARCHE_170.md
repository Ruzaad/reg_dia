# Parche 170 — Cuadro manual también para REPROCESO

**Problema:** el cuadro de prendas y minutos del Inicio (Guardar) solo existía para CORTE.

**Cambio:** `corte_manual` gana `area` (llave `fecha, area`). `fn_corte_manual_guardar` con 5 parámetros sigue guardando CORTE; nueva sobrecarga con `p_area` (CORTE o REPROCESO). `fn_inicio_plan` suma lo manual por área y devuelve `manual_dia`. Sin tablas nuevas.

**Cómo funciona en REPROCESO:** el medidor del día usa lo manual si hay; el acumulado del mes lo suma a lo registrado por tickets.

**Verificar:** `select fn_inicio_plan('<dni>','<token>'::uuid, current_date)::json->'manual_dia';`

**Deshacer:** `sql/parche_170_rollback.sql`.
