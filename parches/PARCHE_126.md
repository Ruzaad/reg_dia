# PARCHE 126 — REPROCESO se trabaja como ACABADO

## El problema
REPROCESO trabajaba por tiempo (lotes con EMPEZAR/TERMINAR) y el parche 123 le
puso un editor de bases aparte. Ruzaad pidió que funcione igual que ACABADO:
las bases se suben en la misma ruta que las de camisa, pantalón, saco y
acabado, y el personal registra cantidades por operación.

## El cambio
- Bases: se suben en Bases, área REPROCESO, con el mismo formato (prenda,
  cliente, artículo, N° de operación, nombre de la operación, STD, operación
  máxima). No hay código nuevo: la pantalla ya lista las áreas con personal.
- Lote = OF provisional: `ofs.reproceso = true` (columna nueva) con la
  cantidad máxima como corte. `fn_reproceso_lote_crear` lo crea o corrige su
  tope; `fn_reproceso_bases` lista las bases y los lotes con su avance. Botón
  "+ Lote de reproceso" en Ingeniería › Trabajo por tiempo y en la supervisora.
- Operario: REPROCESO entra por el mismo flujo de ACABADO (OF → operación →
  cantidad) con `fn_acabado_ofs` / `fn_acabado_registrar`. Escribe el número de
  lote o el artículo en el buscador. Cada registro lleva el STD de la BASE, así
  que entra a eficiencia y bonificaciones.
- Se conserva lo ya generado: la base 9CY740 de `lote_bases` pasa a `bases`
  (REPROCESO) y sus lotes abiertos a OF provisional con 709 prendas. Los lotes
  por tiempo de REPROCESO quedan cerrados (sin prendas registradas).
- Se quitan `fn_lote_bases`, `fn_lote_base_guardar`, `fn_lote_crear_base` y el
  editor de bases por lotes. Las tablas `lote_bases` y `lote_base_ops` no se
  borran. DESPACHO y CORTE siguen por tiempo.

## Cómo verificar
```sql
select articulo, n_op, operacion, std, max_op from bases where area = 'REPROCESO' order by articulo, n_op;
select o_f, articulo, cant_prog from ofs where reproceso;
select estado, count(*) from lotes where area = 'REPROCESO' group by 1;
```
Rollback: `sql/parche_126_rollback.sql`.
