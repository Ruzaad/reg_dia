# PARCHE 113 — Bloquear copias (robustez)

## El problema
Ni ENVIAR ni APROBAR se bloqueaban mientras esperaban respuesta. Desde el
4-ago llegaron 52 pedidos varias veces (hasta 11 copias en 0.25 s) y quedaron
33 incidencias duplicadas con 2,626 min contados dos veces. En Acabado, volver
a tocar REGISTRAR duplicaba el registro (9 casos). Con mala señal salían
mensajes en inglés como "Failed to fetch" y la espera no tenía límite.

## El cambio en la app (no necesita SQL)
- Un toque a la vez: ENVIAR (pedir descuento), APROBAR/RECHAZAR (supervisora e
  Ingeniería), declarar parcial y confirmar regreso quedan bloqueados mientras
  esperan.
- Acabado: no deja registrar dos veces a la vez y, si se repite la misma
  cantidad en la misma operación en menos de 1 minuto, pregunta "¿Otra vez N?".
- Si el conflicto al registrar es con el mismo operario, dice "Ya estaba
  registrado" en vez de un error.
- Mensajes en español: sin señal, sin respuesta en 30 s (límite nuevo) y
  sistema ocupado.
- Aviso "Hay una versión nueva de la app" con botón Actualizar cuando se
  publica una versión mientras la pestaña está abierta (un HEAD a app.js, sin
  consultas a la base).

## Base (`sql/parche_113.sql`)
Mismas firmas, así que protege también a los celulares con la versión vieja.
- `fn_solicitud_ajuste_crear`: candado por persona; el mismo pedido en menos de
  2 minutos no crea otro y responde `repetido`.
- `fn_solicitud_resolver`: bloquea la fila antes de resolver y no deja aprobar
  la copia de un pedido ya aprobado (mismo día, minutos y motivo, enviados con
  menos de 2 minutos de diferencia).
- `fn_acabado_registrar` (7 argumentos): candado por OF y operación mientras
  calcula cuánto queda; la misma persona y cantidad en menos de 5 s se toma
  como reintento. La sobrecarga vieja de 6 argumentos se conserva y pasa por
  la nueva.

Sin tablas nuevas ni cambios de cálculo. No borra las 6 duplicadas de la
quincena 16-30 set: esas las revisa Ruzaad (lista en robustez/).
Rollback: `sql/parche_113_rollback.sql`.
