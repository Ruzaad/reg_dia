# PARCHE 132 — Buscar y Seguir: ACABADO por cantidades

**Problema:** en la ficha de una OF, ACABADO solo mostraba una línea (registros, personas, und) porque no trabaja por paquete.

**Cambio:** `fn_traza_of` (misma firma) agrega a `acabado` el corte real (`cant_prog`) y `ops`: por cada operación de la base, las prendas marcadas. El front calcula las libres (corte − marcadas) y arma el mismo cuadro que costura (barras por módulo + detalle por operación).

**Verificar:** `select fn_traza_of('<dni>','<token>','10188')` → `acabado.ops` trae 20 filas y la suma de `marcadas` coincide con `reclamos` ACTIVO de esa OF. Mide ~20 ms.

**Deshacer:** `sql/parche_132_rollback.sql`.
