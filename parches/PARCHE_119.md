# PARCHE 119 — Tiempos de las áreas sin OF: minutaje y tope en los lotes

Va sobre el parche 116 (trabajo por tiempo de DESPACHO, REPROCESO y CORTE).

## El problema
Con el 116 la gente de esas áreas ya registra lotes, pero lo que hace solo
suma horas aparte: no genera minutaje, así que su boleta, su eficiencia y sus
incentivos siguen dependiendo de incidencias.

## El cambio
- **Ingeniería › Trabajo por tiempo › Tiempos por tarea**: Ingeniería sube el
  tiempo (min por prenda) de cada tarea, uno por uno o pegando desde Excel
  (ÁREA, TAREA, MIN). Ve al lado lo real de los últimos 30 días como
  referencia y avisa si el tiempo queda 20% o más lejos de lo real. Cada cambio
  queda en el historial con quién y cuándo. La supervisora no sube tiempos.
- **Minutaje igual que ACABADO**: un tramo que se cierra con prendas, en una
  tarea con tiempo, guarda un reclamo de prendas × tiempo para el operario con
  la fecha del día trabajado. Desde ahí entra a Mi día, la boleta, la
  eficiencia y los incentivos como cualquier ticket. El tiempo queda congelado
  en el reclamo; cambiarlo después cuenta para lo que venga.
- Al guardar tiempos se puede dar minutaje también a lo ya registrado sin
  tiempo desde una fecha (por defecto, el inicio de la quincena; máximo 31 días).
- **Tope igual que ACABADO**: la suma de prendas de un lote no pasa de su
  cantidad ("van X de Y, quedan Z") al terminar ni al revisar. Quien crea
  lotes puede corregir la cantidad, nunca por debajo de lo hecho.
- El reclamo de un lote no mueve de área a la persona: quien está EN DESPACHO
  sigue siendo de ACABADO.
- Operario: ve cuánto minutaje lleva hoy, cuánto da cada prenda y cuántas
  quedan en el lote.

## Ojo
Cuando una tarea ya tiene tiempo, ese trabajo no debe registrarse además como
incidencia, o el día se cuenta dos veces.

## Base (`sql/parche_119.sql`)
Columnas `lote_tareas.actualizado/actualizado_por`, tabla `lote_tareas_log`,
columna `reclamos.lote_tramo_id`. Funciones nuevas: `fn_lote_tiempos`,
`fn_lote_tiempos_guardar`, `fn_lote_tiempos_log`, `fn_lote_cantidad`.
Cambian: `fn_lote_terminar`, `fn_lote_tramo_revisar`, `fn_lotes_mios`,
`fn_lotes_panel`, `fn_lote_detalle`, `_lote_json` y `_reclamo_mueve_area`.
Rollback: `sql/parche_119_rollback.sql` (borra el minutaje de lotes).
