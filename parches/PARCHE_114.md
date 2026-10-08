# PARCHE 114 — Incidencias y reprocesos por área

## El problema
En 30 días llegaron 622 pedidos de tiempo; ALOPEZ resolvió el 54% y en ACABADO
222 de 258. El 92% se pide después de las 6 pm y la mitad tarda 16 h en
resolverse. El 73% de los minutos de incidencia no es tiempo perdido sino
trabajo en otra cosa (despacho, reproceso, apoyo), pero entra como OTROS con
texto libre, así que nadie lo puede sumar ni cobrar a quien lo causó. Aprobar
y ver pendientes solo pedía ser de INGENIERIA (cualquiera de oficina veía todas
las áreas), y si se borraba la incidencia el pedido seguía "APROBADO".

## El cambio
- **Operario**: botón TRABAJÉ EN OTRA ÁREA (dónde y cuánto, con toques);
  REPROCESOS pregunta de qué área vino y la OF; aviso si ya pidió lo mismo hoy.
  Mi boleta › MIS PEDIDOS DE TIEMPO muestra en qué va cada pedido y el motivo
  del rechazo.
- **Supervisora** (Más › Pedidos del personal): POR REVISAR, EN INGENIERÍA y
  LISTAS. Aprueba sola lo chico (MÁQUINA, MUESTRAS, ARREGLOS o DESCOSER de
  hasta 60 min); al resto le da VISTO BUENO o lo DEVUELVE con motivo.
- **Ingeniería › Incidencias › POR APROBAR**: por área, con cómo queda el día
  (registró + incidencias contra la jornada), el visto bueno y alertas
  (repetido, ya existe igual, pasa el turno). Aprobar en lote lo que tiene
  visto bueno y ninguna alerta roja. Rechazar pide motivo.
- **REPROCESOS Y APOYO**: en qué se fueron los minutos, quién lo hizo y, desde
  ahora, quién lo causó con su OF. Solo lectura, con descarga.
- **Gestión › Permisos**: nivel nuevo **Aprueba** (Edición + aprobar las
  incidencias del área).

## Base (`sql/parche_114.sql`)
- Columnas nuevas en `solicitudes_ajuste` (área donde trabajó, área que lo
  causó, OF, visto bueno, motivo de rechazo; estados DEVUELTO y ANULADO),
  `ocurrencias.solicitud_id` y `permisos_area.aprueba`.
- Arranque: aprueba quien hoy edita el área (KROJAS en PANTALÓN y SACO,
  LFABIAN en CAMISA); ALOPEZ todo por ser administrador. JMAYTA, que resolvió
  pedidos con solo lectura, ya no puede aprobar (está inactivo).
- Enlaza hacia atrás (90 días) las incidencias con su pedido, y un trigger deja
  el pedido ANULADO si se borra su incidencia.
- Nuevas: `fn_solicitudes_panel`, `fn_solicitud_visto_bueno`,
  `fn_solicitudes_mias`, `fn_reprocesos_apoyo`. Cambian (mismas firmas):
  `fn_solicitud_ajuste_crear`, `fn_solicitud_resolver`,
  `fn_solicitudes_listar` (solo tus áreas), `fn_permisos_*`, `fn_mis_permisos`.
- Trae el bloqueo de copias del parche 113 para pedir y aprobar, así que va
  con o sin él.

Celulares con la versión vieja: siguen pidiendo y aprobando; si una
supervisora aprueba algo que no es chico, queda como visto bueno y se le avisa.
Sin el parche, las pantallas nuevas caen a las de antes.
Rollback: `sql/parche_114_rollback.sql` (deja las columnas; si se corrió el
113, después del rollback el pedido vuelve a la versión sin bloqueo).
