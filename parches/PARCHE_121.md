# PARCHE 121 — Calidad de BASES (consulta que faltaba)

## El problema
La pantalla Gestión › Calidad de BASES entró a `qa` como "sin SQL", pero llama
a `fn_bases_calidad`, que nunca se escribió como parche. En la base no existe,
así que la pantalla sale con error.

## El cambio
- `fn_bases_calidad(p_dni, p_token)`: la consulta de solo lectura del preview
  del 8-oct (`consulta_calidad_bases.sql`) convertida en RPC. Devuelve las
  áreas, los avisos (registran sin BASE, artículo escrito de dos formas,
  STD 0, BASE incompleta, OF sin BASE, STD muy distinto, operaciones que
  nadie registra, total raro) y la cobertura de ACABADO.
- La ve quien tenga la pestaña Calidad de BASES o BASES en Gestión › Permisos.
  Cada quien recibe solo los avisos de sus áreas; la cobertura de ACABADO solo
  si tiene ACABADO. El administrador y quien tiene todas las áreas ve todo.
- Si el parche no está corrido, la pantalla dice "Falta correr el parche 121".

## Qué no cambia
No crea tablas, no toca datos ni otras funciones. Tarda unos 2 s con todas
las áreas (medido en producción el 9-oct).

## Rollback
`sql/parche_121_rollback.sql` (quita la función).
