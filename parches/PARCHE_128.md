# Parche 128 — Reclasificación de REPROCESO

**Problema:** en REPROCESO, además de avanzar operaciones, se reclasifican las prendas (artículo, color, talla, tipo de falla, cantidad) y eso solo vivía en la hoja en papel.

**Cambio:** tabla `reproceso_reclasif` y tres RPC (`fn_reproceso_reclasif_info`, `fn_reproceso_reclasificar`, `fn_reproceso_reclasif_anular`). Se cuelga de la **penúltima operación** del artículo (`_ultimas`, parche 125): el total reclasificado de un lote no puede pasar de lo reportado en esa operación. Cualquier operario de REPROCESO (o Ingeniería/supervisión con Edición en el área) puede anotarla. No genera minutos. En el celular, la tarjeta de esa operación muestra el botón «Reclasificar» (`app.js`); sin el parche el botón simplemente no aparece.

**Verificar:**
```sql
select to_regclass('public.reproceso_reclasif');  -- no null
select count(*) from pg_proc where proname like 'fn_reproceso_reclasif%';  -- 3
```
Rollback: `parche_128_rollback.sql` (borra lo anotado).
