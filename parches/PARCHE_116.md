# PARCHE 116 — Trabajo por tiempo (DESPACHO, REPROCESO y CORTE)

## El problema
DESPACHO, REPROCESO y CORTE no tienen OF ni BASE. En 30 días, 917 h de ese
trabajo (185 incidencias, 48 personas) quedaron como incidencia con texto
libre, y CORTE y REPROCESO no tienen cómo registrar lo que hacen.

## El cambio
- **Lote** = área + cliente o destino + tarea de una lista corta + cantidad
  de prendas, con OF opcional.
- **Operario**: CORTE y REPROCESO entran directo a sus lotes; quien hoy está
  EN DESPACHO, EN REPROCESO o EN CORTE ve un aviso arriba de su lista de OF.
  Toca el lote y EMPEZAR; al acabar, TERMINAR y cuántas prendas (o "que lo
  ponga mi supervisora"). La hora la pone el servidor.
- Si se olvida de terminar, el tramo se cierra solo a las 18:20 y queda
  **por revisar**.
- **Supervisora** (Más › Trabajo por tiempo): la de ACABADO crea lotes de
  DESPACHO y REPROCESO, la de CORTE los de CORTE. Pone la cantidad de lo que
  quedó por revisar y cierra lotes.
- **Ingeniería › Tickets › Trabajo por tiempo**: horas, prendas, min/prenda
  real, estándar y eficiencia (solo si la tarea tiene estándar), por revisar,
  detalle de quién trabajó y descarga. Para verlo hace falta la pestaña en
  Permisos y el área (DESPACHO y REPROCESO van con ACABADO); para crear y
  cerrar, Edición.

## Qué NO cambia
Boleta, eficiencia e incentivos siguen igual: los minutos en lotes se ven
aparte. Queda por decidir si EN DESPACHO / EN REPROCESO / EN CORTE pasan a
exigir 575 min cubiertos con lotes.
El refrigerio (13:00 a 13:45) no cuenta en los minutos de un tramo.

## Base (`sql/parche_116.sql`)
Tablas nuevas `lote_tareas`, `lotes` y `lote_tramos` (sin acceso directo
desde la app, solo por funciones). Funciones: `fn_lotes_mios`,
`fn_lote_empezar`, `fn_lote_terminar`, `fn_lote_tareas`, `fn_lote_crear`,
`fn_lote_cerrar`, `fn_lotes_panel`, `fn_lote_detalle` y
`fn_lote_tramo_revisar`. Doble toque protegido en empezar, terminar y crear.
Sin el parche, la pantalla avisa que falta correrlo y el operario no ve nada
nuevo.
Rollback: `sql/parche_116_rollback.sql` (borra las tablas con lo registrado).
