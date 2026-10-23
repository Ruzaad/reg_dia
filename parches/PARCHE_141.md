# Parche 141 — Editar lotes de REPROCESO (nombre y cantidad)

## Problema
Un lote de REPROCESO no se podía renombrar, y su cantidad no podía bajar de lo ya notificado en una operación («Ya van N prendas… no puede ser menor»). Si el analista se equivocaba al crear el lote, no había salida. Además la vista de Reproceso en Ingeniería era una lista larga de barras por operación.

## Cambio
- `fn_reproceso_lote_editar(p_dni, p_token, p_of, p_nombre, p_cantidad, p_simular)`: cambia nombre y cantidad. Renombrar actualiza `ofs`, `reclamos` y `reproceso_reclasif`; rechaza un nombre que ya existe.
- **Cantidad menor o igual a lo notificado:** no se quita nada. **Cantidad mayor:** solo sube el tope.
- **Cantidad menor que lo notificado en una operación:** el exceso se resta de los registros de esa operación **en proporción a lo que aportó cada registro (persona y día)**, no de golpe en un día. Ejemplo: 600 prendas hechas en 6 días de 100 y el lote baja a 400 → se descuentan 200 repartidas (34, 34, 33, 33, 33, 33). Cada operación se calcula por separado. Los minutos se recalculan solos (`minutos = std × cant`).
- `p_simular = true` devuelve el efecto (quién, qué días, cuánto) sin guardar; el front lo muestra antes de GUARDAR.
- Cada edición queda en `reproceso_lote_cambios` y cada registro tocado en `reproceso_lote_ajuste` (cantidad antes y después), para poder deshacer.
- No se toca `fn_reproceso_lote_crear` (los fronts viejos siguen igual).
- Front (`lotes.js`, `rediseno.css`): Reproceso de Ingeniería con tarjetas KPI (lotes abiertos, prendas en proceso, minutos, avance medio), chips por operación y botón **Editar**. La supervisora conserva su vista actual.

## Verificar
```sql
select proname from pg_proc where proname = 'fn_reproceso_lote_editar';   -- 1 fila
```
Luego en Ingeniería › Reproceso: Editar un lote, bajar la cantidad y comprobar que el aviso muestra el descuento por día antes de guardar.

## Deshacer
Correr `parche_141_rollback.sql`: devuelve las cantidades descontadas y borra la función y las dos tablas. Los nombres y topes cambiados no se revierten solos (están en `reproceso_lote_cambios`).
