# PARCHE 125 — Última y penúltima operación elegidas por el analista

## El problema
La "última" y "penúltima" operación de cada artículo salían siempre del N°OP
(el mayor y el siguiente). En algunos artículos la operación que cierra el
balance es otra, y no había forma de cambiarla.

## El cambio
- Base (`sql/parche_125.sql`):
  - Tabla `ultimas_articulo` (área × artículo): guarda la elección por `op_id`
    y el nombre de la operación de respaldo por si la BASE se vuelve a subir.
  - `_ultimas(área)`: N°OP efectivo de la última y penúltima. Sin elección,
    la regla de siempre. Si solo se fija la última, la penúltima es el mayor
    N°OP por debajo de ella.
  - `fn_ultimas_area` (lectura) y `fn_ultimas_guardar` (Ingeniería con acceso
    al área; lo mismo que la regla automática no se guarda).
  - `fn_costos_reporte` y `fn_avance_area` usan `_ultimas`. Misma firma y
    misma respuesta: los despliegues viejos siguen funcionando.
- App: en Ingeniería › Bases, botón **★ ÚLTIMA / PENÚLTIMA** con la lista de
  artículos del área y dos selectores por artículo. Las estrellas de Bases y de
  Costos › Balance, las tarjetas de Tickets › Actual y el Reporte de hoy
  usan la elección. Sin el parche corrido, la app sigue con la regla del N°OP.
- No cambia: el troceo al generar la OF ("dividir última / penúltima") ni la
  "última del módulo" de Avance por módulo, que son otra cosa.

## Cómo verificar
```sql
select * from _ultimas('CAMISA COSTURA') where manual;   -- vacío al inicio
```
En Bases elige otra última para un artículo: la ★ dorada se mueve y la
consulta de arriba la muestra con `manual = true`.

Medido en producción (13-oct): `_ultimas` de todas las áreas, ~0.3 s.

Rollback: `sql/parche_125_rollback.sql`.
