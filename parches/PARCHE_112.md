# PARCHE 112 — La supervisora en el celular y sus horas extra

## El problema
La supervisora trabaja 100% desde el celular, pero la vista tenía 8 pestañas
que no entran en el ancho del teléfono. Las horas extra las registra la
oficina al día siguiente (352 registros al mes; la supervisora, 0), así que
esa gente sale con eficiencia baja hasta entonces.

## El cambio
- **Hoy** es la primera pantalla: tarjetas con lo que le toca según la hora.
  En la mañana: confirmar la asistencia de ayer, marcar quién faltó hoy,
  pedidos del personal y "¿Alguien se quedó ayer?". Desde las 2 pm: pedidos,
  regresos por confirmar, "¿Quién se queda hoy?" y quién no tiene tickets
  hoy. Lo hecho baja a "Ya está". Usa las RPC de siempre, en paralelo.
- **Barra de abajo** con Hoy · Personal · Avance · Más. Más lleva Asistencia,
  Pedidos, Horas extra, Bases, Eficiencias, Quién reclamó (antes Tickets por
  OF), Boletas, Cambiar mi PIN y Salir. Las pantallas son las mismas.
- **Horas extra**: Hoy o Ayer, horas en pasos de media hora (arranca en 2 h,
  tope 4 h), "Los mismos de la última vez" y la lista con los tickets del día.
  Se registra al instante.

### Base (`sql/parche_112.sql`)
- `fn_sup_he_lista(dni, token, area, fecha)`: solo lectura. Personal del área
  con estado, tickets y horas extra de ese día, más la última vez que hubo
  horas extra en el área (60 días).
- `fn_sup_horas_extra(dni, token, fecha, minutos, dnis)`: solo SUPERVISORA,
  solo su área, solo hoy o ayer, de 30 a 240 min y sin pasar de 4 h por
  persona y día. Salta a quien estuvo ausente. Guarda en `ocurrencias` como
  HORA_EXTRA con su DNI como autora, así que Ingeniería la ve y la corrige en
  Incidencias. Un candado por supervisora evita que un doble toque duplique.

Sin tablas nuevas ni cambios de cálculo. Rollback: `sql/parche_112_rollback.sql`
(las horas extra ya registradas se quedan). Sin el parche, todo lo demás
funciona y la pantalla de Horas extra avisa que falta.
