# Parche 127 — Quitar las bases por lote del 123

**Problema:** el 126 pasó REPROCESO a bases normales (como ACABADO). Las tablas `lote_bases`, `lote_base_ops` y la columna `lotes.base_op_id` del 123 ya no se usan.

**Cambio:** `_lote_std`, `_lote_json` y `fn_lote_tiempos` vuelven al tiempo por tarea (sin mirar la base del lote) y se borran las dos tablas y la columna. Los 7 lotes que tenían base la pierden; su base ya está en `bases` (126).

**Verificar:**
```sql
select count(*) from information_schema.columns where table_name='lotes' and column_name='base_op_id'; -- 0
select to_regclass('public.lote_bases'), to_regclass('public.lote_base_ops'); -- null, null
```
Rollback: `parche_127_rollback.sql` (recrea las tablas vacías).
