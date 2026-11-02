# Parche 159 — PCP: UDP fuera de la tabla de metas por área

**Problema:** la tabla de metas por área de PCP mostraba UDP con personas, disponible y meta. UDP se mapea pero no es dato.

**Cambio:** `fn_pcp_resumen` (misma firma) deja de devolver UDP en `areas`. El front de PCP y la tarjeta "Sin BASE" de Carga vs capacidad también la filtran (sirve aunque el SQL no esté corrido).

**Verificar:** `select fn_pcp_resumen('<dni>','<token>'::uuid)::text like '%"area":"UDP"%';` da false.
