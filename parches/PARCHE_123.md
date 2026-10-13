# PARCHE 123 — Bases de REPROCESO y lote = base × cantidad

## El problema
Cada tarea de lotes tenía un solo tiempo para toda el área: DESARMAR CAMISA
valía igual para cualquier prenda, y para armar el lote 9CY740 había que tocar
sus 7 operaciones una por una. REPROCESO necesita bases como ACABADO: por
prenda, las operaciones en orden con su tiempo, y al crear el lote cruzar esa
base con la cantidad máxima.

## El cambio
- Tablas `lote_bases` (área + nombre: prenda, artículo o cliente) y
  `lote_base_ops` (operaciones en orden con su min/prenda). `lotes.base_op_id`
  dice de qué operación de qué base salió cada lote.
- `fn_lote_bases`, `fn_lote_base_guardar` (Ingeniería con Edición en el área;
  la supervisora solo las usa) y `fn_lote_crear_base`: crea un lote por
  operación de la base, en orden, todos con la misma cantidad como tope.
- `_lote_minutaje` y `_lote_json` toman el tiempo de la base cuando el lote la
  tiene (`_lote_std`); sin base, el tiempo por tarea de siempre. El tiempo queda
  congelado al registrar, como el STD de un ticket.
- Arranque: crea la base CAMISA de REPROCESO con las 7 tareas que ya tienen
  tiempo y le engancha los lotes abiertos de 9CY740. Mismos tiempos: el
  minutaje no cambia.
- App: Ingeniería › Trabajo por tiempo › "Bases de reproceso" (ver, crear,
  editar, ordenar, pegar desde Excel). Nuevo lote (Ingeniería y supervisora)
  pide la base y la cantidad máxima. El operario ve las operaciones de un lote
  juntas y en orden ("2 de 7").
- CORTE no se toca. Las RPC viejas siguen igual.

## Cómo verificar
```sql
select b.nombre, k.n_op, k.operacion, k.std
  from lote_bases b join lote_base_ops k on k.base_id = b.id order by b.id, k.n_op;
select id, destino, tarea, base_op_id from lotes where estado = 'ABIERTO' order by id;
```
Rollback: `sql/parche_123_rollback.sql`.
