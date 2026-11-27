# Parche 199 — Estructura sin roles de oficina

**Problema:** en "Agregar a la estructura" aparecían personas de Ingeniería y Costos, que nunca van en la estructura.
**Cambio:** `fn_estructura_candidatos` solo lista roles OPERARIO y SUPERVISORA; `fn_estructura_agregar` rechaza cualquier otro rol.
**Verificar:** buscar un usuario de Ingeniería en Estructura › Agregar: no aparece.
**Deshacer:** `sql/parche_199_rollback.sql`.
