# Parche 136 — Reclasificar rápido (REPROCESO)

**Problema:** en la pantalla Reclasificar (parche 128) había que escribir a mano color, talla, tipo de falla y cantidad, y repetirlo por cada talla. Quien reporta no puede estar todo el día escribiendo.

**Cambio:** tres RPC nuevas y la columna `reproceso_reclasif.tanda`.
- `fn_reproceso_reclasif_info2`: lo del parche 128 más tallas de la prenda, colores, cuadro falla × talla y tandas guardadas.
- `fn_reproceso_reclasificar_varias`: guarda una falla con varias tallas (todo o nada, tope = lo reportado en la penúltima operación).
- `fn_reproceso_reclasif_anular_tanda`: anula una tanda completa.
La pantalla (`app.js`, `rediseno.css`) elige color y falla con botones, la cantidad por talla con teclado numérico, y se queda abierta para la siguiente falla. Las RPC del parche 128 se quedan; sin este parche la pantalla de antes sigue funcionando.

**Verificar:**
```sql
select count(*) from pg_proc where proname in ('fn_reproceso_reclasif_info2','fn_reproceso_reclasificar_varias','fn_reproceso_reclasif_anular_tanda');  -- 3
select column_name from information_schema.columns where table_name='reproceso_reclasif' and column_name='tanda';  -- 1 fila
```
Rollback: `parche_136_rollback.sql` (lo ya reclasificado se conserva).
