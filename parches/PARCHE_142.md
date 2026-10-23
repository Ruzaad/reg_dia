# Parche 142 — Eliminar lote de REPROCESO

## Problema
Un lote creado por error (nombre o artículo equivocado) solo se podía cerrar, y seguía apareciendo en «Cerrados».

## Cambio
- `fn_reproceso_lote_eliminar(p_dni, p_token, p_of)`: borra el lote **solo si no tiene registros** (ni cantidades en `reclamos` ni reclasificaciones). Si ya tiene trabajo responde «Ciérralo en vez de eliminarlo», para no perder eficiencia ni historial.
- Deja constancia en `reproceso_lote_cambios` (`of_despues = '(ELIMINADO)'`).
- Front (`lotes.js`): tercer botón **Eliminar** en cada tarjeta de Ingeniería › Reproceso, con confirmación.

## Verificar
```sql
select proname from pg_proc where proname = 'fn_reproceso_lote_eliminar';   -- 1 fila
```
Crear un lote de prueba, eliminarlo y comprobar que desaparece; intentar eliminar uno con registros y ver el aviso.

## Deshacer
Correr `parche_142_rollback.sql` (quita la función; los lotes ya eliminados se recrean desde Crear lote).
