# Parche 145 · Subir programa de costura (DELETE sin WHERE)

**Problema.** Al subir el programa de PCP, la base respondía «DELETE requires a WHERE clause» y no se guardaba nada.

**Cambio.** `fn_pcp_programa_cargar` borra con `delete from pcp_programa where true`. Misma firma, mismo resultado. El parche 144 del repo ya quedó corregido para instalaciones nuevas.

**Cómo verificar.** Ingeniería › PCP › Subir programa de costura: debe decir «Programa subido: N filas». En SQL: `select tipo, archivo, filas from pcp_cargas;` y `select count(*) from pcp_programa;`.

**Deshacer.** `sql/parche_145_rollback.sql`.
