# PARCHE 132 — Buscar y Seguir: ACABADO por cantidades y OF COMPLETADA

**Problema:** en la ficha de una OF, ACABADO solo mostraba una línea (registros, personas, und) porque no trabaja por paquete.

**Cambio:** `fn_traza_of` (misma firma) agrega a `acabado` el corte real (`cant_prog`) y `ops`: por cada operación de la base, las prendas marcadas. El front calcula las libres (corte − marcadas) y arma el mismo cuadro que costura (barras por módulo + detalle por operación).

**Verificar:** `select fn_traza_of('<dni>','<token>','10188')` → `acabado.ops` trae 20 filas y la suma de `marcadas` coincide con `reclamos` ACTIVO de esa OF. Mide ~20 ms.

**Deshacer:** `sql/parche_132_rollback.sql`.

## OF COMPLETADA ("No vigente")
- Nueva `fn_of_completar(dni, token, área, OF, completar)`: solo INGENIERIA. `true` cierra todos los módulos de la OF en esa área (`modulos_cerrados`), `false` los reabre. Cerrados, sus tickets sin reclamar no cuentan como pendientes y nadie puede reclamarlos.
- `fn_traza_of` agrega `completada` por área y `cerrado` por módulo.
- Front: en Carga vs capacidad, las OF "¿Vigente?" y "Sin movimiento" tienen el botón **No vigente**. En Buscar y Seguir se ve COMPLETADA y hay **Reabrir**.
- Se quitó la pantalla Avance por módulo (nunca se ve en el menú; la RPC `fn_mod_avance` queda en la base sin uso).

**Verificar:** `select fn_of_completar('<dni>','<token>','CAMISA COSTURA','10155', true)` devuelve `modulos` > 0 y `select count(*) from modulos_cerrados where o_f='10155'` coincide; con `false` vuelve a 0.
