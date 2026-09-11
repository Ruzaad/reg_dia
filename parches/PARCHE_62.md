# PARCHE 62 — Cache de tickets_area

## Problema
`fn_tickets_area` recalculaba el catálogo completo de tickets del área en
cada llamada (vía `fn_tickets_of_raw`). Medido en vivo: 37,531 filas para
CAMISA COSTURA, 2.8s solo de cómputo en Postgres. Logs de las últimas 24h:
decenas de llamadas de 3–8s a `fn_tickets_area`, y un 504 real en
`fn_reclamados` por contención mientras corría en paralelo.

## Cambio
- Tabla nueva `tickets_cache` (área, código, ...) — snapshot de
  `fn_tickets_of_raw` por área.
- `fn_tickets_cache_refrescar(p_area)` — recalcula y reemplaza la cache de
  un área.
- `fn_tickets_area` ahora lee de `tickets_cache` (mismo contrato de salida,
  cero cambios en el frontend).
- Se agregó `perform fn_tickets_cache_refrescar(...)` al final de cada
  función que puede cambiar el catálogo de un área:
  `fn_base_articulo_eliminar`, `fn_base_articulo_guardar`,
  `fn_base_op_crear`, `fn_base_op_editar`, `fn_base_op_eliminar` (2 y 4
  args), `fn_bases_subir`, `fn_of_generar`. `fn_of_registrar` refresca solo
  si la OF ya estaba generada en alguna área (caso borde: re-subir HN
  después de generar).
- Backfill: se llena la cache para las áreas que ya tienen OF generada.

## Riesgo / rollback
Aditivo: no se borró ninguna función ni tabla. Si algo falla, `fn_tickets_area`
puede volver a su versión anterior (llamar `fn_tickets_of_raw` directo) sin
tocar lo demás. La cache puede quedar desactualizada solo si se descubre un
camino de escritura no cubierto aquí — en ese caso, correr manualmente
`select fn_tickets_cache_refrescar('ÁREA');`.

## Pendiente a vigilar
Si en el futuro se agrega otra función que modifique `bases`, `of_troceo`,
`of_detalle` u `of_generada`, hay que agregarle el mismo
`perform fn_tickets_cache_refrescar(...)`.
