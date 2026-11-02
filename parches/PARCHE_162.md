# Parche 162 — Última / penúltima por prenda y Cantidad por área con la penúltima

**Problema:**
- Dashboards › Cantidad por área contaba la ÚLTIMA operación (`max_op`) y solo daba el total por área.
- En Bases › ★ ÚLTIMA / PENÚLTIMA solo se podía fijar una última y una penúltima por artículo. En ACABADO hay artículos con dos prendas en la misma BASE (TE4563 y TE5247: SACO y PANTALON) que se separan por prenda.

**Cambio (base):**
- Tabla `ultimas_prenda` (área × artículo × prenda), igual a `ultimas_articulo`.
- `_ultimas_por_prenda(área)`: una fila por área × artículo × prenda. Con una sola prenda da lo mismo que `_ultimas` (usa `ultimas_articulo`); con varias, cada prenda tiene su mayor N°OP y el siguiente, o lo que fijó Ingeniería. (No se llama `_ultimas_prenda` porque Postgres ya usa ese nombre para el tipo arreglo de la tabla `ultimas_prenda`.)
- `fn_ultimas_prenda_area` / `fn_ultimas_prenda_guardar`: lectura y guardado por prenda (solo artículos con varias prendas).
- `fn_cantidad_penultima`: cantidad de la PENÚLTIMA operación por área, prenda y artículo (si el artículo tiene una sola operación cuenta esa). `fn_cantidad_areas` se queda para los despliegues viejos.
- No cambian `_ultimas`, `ultimas_articulo`, Costos, Tickets, Avance ni Reporte de hoy.

**Cambio (app):**
- Cantidad por área: gráfico con la penúltima y cuadro resumen abajo: áreas colapsadas → prendas → artículos, con % del total y TOTAL. Sin el parche corrido cae al reporte viejo (última).
- ★ ÚLTIMA / PENÚLTIMA: lista solo los artículos que se ven en Bases con los filtros puestos (prenda, artículo, operación, cliente, módulo) más un filtro propio; una fila por prenda si el artículo trae varias; la operación se elige en un cuadro de texto que busca mientras escribes (vacío = automática). Las ★ de la tabla de Bases siguen la elección por prenda.

**Verificar:**
```sql
select * from _ultimas_por_prenda('ACABADO') where multi;   -- TE4563 y TE5247, una fila por prenda
```
Medido en producción (solo lectura, 2-nov): la consulta de `fn_cantidad_penultima` para octubre ~0,4 s; un año completo de tickets ~1,5 s.

Rollback: `sql/parche_162_rollback.sql`.
