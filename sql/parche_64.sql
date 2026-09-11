-- PARCHE 64 — Elimina mig_p35_codigos (log de migración puntual, sin uso)
-- Verificado antes de borrar: sin referencias en app.js/ingenieria.js, sin
-- referencias en el código de ninguna función SQL (búsqueda en prosrc), sin
-- referencias en el edge function generar-tickets, sin vistas ni FKs que
-- dependan de ella (solo tenía su propia PK). 3,908 filas, todas del mismo
-- instante (18-ago-2026, migración del parche 35), 0 con cod_nuevo pendiente.
drop table if exists mig_p35_codigos;
