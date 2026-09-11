# PARCHE 64 — Elimina mig_p35_codigos

## Qué era
Log de una migración puntual (parche 35, mapeo de códigos de ticket viejos →
nuevos). Todas sus 3,908 filas tienen el mismo timestamp (18-ago-2026): fue
un `INSERT` de una sola vez, no un log que sigue creciendo.

## Verificación antes de borrar
- `grep` en `app.js` / `ingenieria.js`: 0 referencias.
- Búsqueda en `prosrc` de todas las funciones SQL del esquema `public`:
  0 referencias.
- Código del edge function `generar-tickets`: 0 referencias (solo escribe a
  Google Sheets).
- `pg_constraint`: solo su propia PK, ninguna FK hacia/desde otra tabla.
- Ninguna vista depende de ella.
- 0 filas con `cod_nuevo` sin resolver (la migración quedó completa).

## Cambio
`drop table if exists mig_p35_codigos;`

## Riesgo / rollback
No hay rollback (era una tabla de solo-lectura histórica, sin backups
explícitos de este patch). Si algún día se necesita el mapeo viejo→nuevo de
esa migración puntual, está en el historial de git de este repo (parche 35)
y en los backups automáticos de Supabase (point-in-time recovery, según el
plan del proyecto).
