# Parche 153 — Corte requerido = CORTE REAL de NOTI_CORTE
**Problema.** Cronogramas tomaba lo requerido del cronograma/programa de PCP; una OF con su corte real completo (p. ej. 10464: 280 de 280) salía "Incompleto".
**Cambio.** `pcp_corte.corte_real`; `fn_pcp_corte_cargar` lo guarda y `fn_pcp_cronos` lo usa primero como lo requerido. Hay que volver a subir NOTI_CORTE.
**Verificar.** Tras subir NOTI_CORTE, la OF 10464 sale Disponible.
**Deshacer.** `sql/parche_153_rollback.sql`.
