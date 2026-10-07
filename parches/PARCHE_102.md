# PARCHE 102 — Liberar y mover tickets: vista previa, deshacer y registro

## El problema

"Suelen mover por mover los tickets." Hoy:

- Liberar (Tickets · Actual y Reclamados x Operación) y mover de día (Corregir
  fechas) se confirmaban con un `prompt`/`confirm` que solo decía cuántos.
- No quedaba **quién** lo hizo ni **cuándo**. Mover de día pisaba la fecha: la
  anterior se perdía.
- El motivo de liberar era opcional: 232 tickets de los últimos 30 días quedaron
  con el texto por defecto "Liberado por ingeniería".
- No había forma de volver atrás.

Desde el parche 95 la base ya rechaza liberar o mover en un área de solo lectura
(trigger `perm_area_trg`), así que hoy solo pueden hacerlo ALOPEZ (todo), LFABIAN
(CAMISA) y KROJAS (SACO y PANTALÓN). Lo de antes no se puede atribuir: no se
guardaba.

## El cambio

### Base (`sql/parche_102.sql`)

- `tickets_cambios`: una fila por acción (LIBERAR, MOVER, PARTIR, DESHACER) con
  quién, cuándo, motivo, áreas y un resumen (personas, OFs, días de y a).
- `tickets_cambios_det`: cada fila de `reclamos` y `residuales` que tocó, antes y
  después. La llena un trigger mientras la acción está abierta, así que también
  queda lo que hace `_deshacer_troceo` (paquete que vuelve entero, residuales
  anulados, reclamos de otras personas liberados).
- `fn_liberar_ids`, `fn_liberar_ticket`, `fn_liberar_lote`,
  `fn_reclamos_cambiar_fecha` y `fn_reclamo_partir` conservan su firma (los
  despliegues viejos siguen funcionando) y ahora:
  - registran el cambio y devuelven su id (`cambio`);
  - liberar **exige motivo**;
  - mover solo toca tickets **ACTIVOS** que de verdad cambian de fecha.
- `fn_tickets_previa`: qué se va a liberar o mover, agrupado por persona, OF,
  operación y día; qué se queda fuera (ya liberados, misma fecha, áreas de solo
  lectura) y avisos (residuales de otras personas, fecha futura, más de 7 días,
  varias personas, tickets viejos). No toca nada.
- `fn_tickets_deshacer`: deja todo como estaba. Lo puede hacer quien hizo el
  cambio dentro de 24 horas, o el administrador. Se niega si alguna fila cambió
  después o si el paquete ya lo volvió a tomar otra persona, y dice cuál. El
  deshacer también queda en el historial.
- `fn_tickets_cambios_listar` y `fn_tickets_cambio_detalle`: el historial. Cada
  quien ve los cambios de las áreas que puede leer; el administrador, todos.

### Pantallas (`ingenieria.js`, `ingenieria.html`, `rediseno.css`)

- Liberar (uno o en lote, en Actual y en Reclamados x Operación) y Aplicar cambio
  de Corregir fechas abren una **vista previa** con lo que se toca y el motivo
  obligatorio. El botón dice cuántos: "LIBERAR 4 TICKET(S)".
- Al terminar, el aviso verde trae **Deshacer** durante 12 segundos (también al
  Partir).
- Nueva vista **Tickets · Historial de cambios**: cuándo, quién, qué, de quién,
  OF, días, motivo, Ver (ticket por ticket) y Deshacer cuando corresponde.
- El botón LIBERAR y las casillas del lote ya no salen en áreas de solo lectura.
- Si la base aún no tiene el parche, la vista previa se arma con lo que hay en
  pantalla y todo sigue como antes.

## Cómo se comprobó

Postgres 16 local con las tablas y funciones de producción que intervienen
(`_deshacer_troceo`, `_perm_area_trg`, `fn_validar_ingenieria`):

- liberar sin motivo se rechaza; con motivo libera, deshace el troceo y libera
  el residual de la otra persona; deshacer devuelve paquete, residual y reclamos
  exactamente como estaban;
- mover a otra fecha, alguien la vuelve a cambiar, deshacer se niega; al
  restaurarla, deshacer funciona; partir y deshacer borra la parte nueva y
  devuelve la cantidad;
- si el paquete liberado ya lo tomó otra persona, deshacer se niega con su nombre;
- LFABIAN no puede deshacer lo de ALOPEZ ni liberar en SACO (solo lectura);
- el parche corre dos veces sin error; el rollback y volver a aplicarlo, también.

Rollback: `sql/parche_102_rollback.sql` (las tablas del historial se quedan).
