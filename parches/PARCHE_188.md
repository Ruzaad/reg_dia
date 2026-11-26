# PARCHE 188 — PCP: meta de Corte como en la vista de Corte

**Problema:** OF 4000010445 tenía corte real 594 y se marcaba 99 %, porque la meta era lo programado de costura (600).
**Cambio:** `fn_pcp_etapas` y `fn_pcp_etapa_detalle` usan la meta de Corte de la vista de Corte (parche 153): corte real; si no hay, el cronograma de corte; si no, lo programado de costura. Solo lectura, mismas firmas.
**Verificar:** la OF 4000010445 muestra Corte 100 %.
**Deshacer:** `sql/parche_188_rollback.sql`.
