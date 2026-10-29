# Parche 152 — Cronogramas con lo real
**Problema.** PCP solo tenía cronogramas subidos; no había forma de ver con lo real cuándo una OF queda lista para costura ni qué carga le llega a ACABADO.
**Cambio.** `_acab_sub` (Camisería, Saco, Pantalón dentro de ACABADO), `fn_pcp_cronos(desde, hasta)` (corte → costura con fecha de corte completo; carga semanal y por OF de ACABADO desde la penúltima operación de costura) y `_pcp_prod` reescrita con la misma salida (verificado: 0 diferencias en 99 día×área de octubre) y ~5 veces más rápida. Front: pestaña Planificación › Cronogramas.
**Verificar.** `select fn_pcp_cronos('<dni>','<token>'::uuid,'2026-11-01','2026-11-30');` devuelve ok:true.
**Deshacer.** `sql/parche_152_rollback.sql`.
