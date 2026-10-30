# Parche 156 — Inicio: la estructura cuenta solo MOD activos

**Problema:** la estructura del Inicio contaba también MOI, personas inactivas y personas dadas de baja.

**Cambio:** `fn_inicio_plan` (corrige el 155) toma solo tipo MOD, con operario ACTIVO y sin baja vigente. UDP sigue fuera.

**Verificar:** en octubre la estructura queda en 158 MOD activos (Acabado 20, Camisa 42, Corte 21, Pantalón 39, Reproceso 6, Saco 30).
