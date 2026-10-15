# Parche 129 — Vista de REPROCESO: abrir, cerrar y ver el progreso de los lotes

**Problema:** los lotes de REPROCESO (OF provisionales del 126) solo se podían crear desde un modal; no había dónde ver su avance ni cerrarlos, y la pantalla «Trabajo por tiempo» seguía hablando de CORTE y DESPACHO, que todavía no se toman.

**Cambio:**
- `ofs.reproceso_cerrado` y `reproceso_cerrado_por`. `fn_acabado_ofs` (misma versión de producción) deja de listar al operario los lotes cerrados.
- `fn_reproceso_lotes`: todos los lotes con avance por operación, personas, minutos y reclasificadas. `fn_reproceso_lote_estado`: cerrar o reabrir (solo con Edición en REPROCESO).
- Front: la pestaña de Ingeniería «Trabajo por tiempo» pasa a ser «Reproceso» (tarjetas por lote, filtro Abiertos/Cerrados, Cerrar/Reabrir, Cambiar tope, + Crear lote); la supervisora ve lo mismo en «Lotes de reproceso». DESPACHO y CORTE ya no tienen vista ni tarjeta de área (`AREAS_LOTE` vacío). Las tablas y RPC del trabajo por tiempo siguen en la base, sin uso.

**Verificar:**
```sql
select count(*) from information_schema.columns where table_name='ofs' and column_name='reproceso_cerrado'; -- 1
select count(*) from pg_proc where proname in ('fn_reproceso_lotes','fn_reproceso_lote_estado'); -- 2
```
Rollback: `parche_129_rollback.sql` (devuelve `fn_acabado_ofs` a la versión anterior; los lotes cerrados vuelven a salir).
