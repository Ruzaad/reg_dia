# PARCHE 103 — Boletas sin llenar al cierre del día

> **Sin aplicar.** Lo corre Ruzaad en el SQL Editor (`sql/parche_103.sql`).
> Vuelta atrás: `sql/parche_103_rollback.sql`. Requiere los parches 93, 95, 98 y 101.

## El problema

Muchos operarios no llenan su boleta y recién se nota a fin de mes, cuando se
arma el pago. Mi boleta (parche 93) le dice a cada operario qué días tiene
PENDIENTES, pero nadie más lo veía por área, así que no se reclamaba el mismo día.

## El cambio

**Base (`sql/parche_103.sql`).**

- `_boleta_estados(dnis, desde, hasta)`: el cálculo de `fn_mi_boleta` para
  muchas personas a la vez. ENTREGADO (tickets ACTIVOS o incidencias que cubren
  575 min), AUSENTE (`_ausente`: faltas, DM, vacaciones y EN DESPACHO,
  REPROCESO, ALMACÉN, CORTE, SASTRERÍA), SIN_LABOR (fin de semana, antes de su
  primer registro, o su área no registró tickets ese día) y PENDIENTE.
  Para saber si ya existía mira reclamos de los últimos 90 días (toda la tabla
  tarda 1 s); asistencia e incidencias, completas.
- `_boletas_areas(dni, token, área)`: la supervisora ve solo su área actual; la
  oficina necesita la pestaña `pasoBolSin` (o `pasoSupArea`) y ve las áreas que
  lee en Permisos; el administrador, todas. Área vacía = todas las suyas.
- `fn_boletas_sin_llenar(dni, token, fecha, área)`: resumen por área (total,
  pendientes, entregados, ausentes, sin labor) y, de cada persona sin boleta,
  su último ticket, sus últimos 11 días laborables, cuántos de esos le faltan y
  si ya se le avisó. Ordena por área y por los que más deben.
- `boletas_avisos` (dni, fecha, avisado_por, creado) y `fn_boleta_avisar`
  (marcar o quitar). Puede avisar quien puede ver a esa persona.
- La pestaña `pasoBolSin` se da a quien ya tenía "Operar como › Supervisora"
  (KROJAS, LFABIAN, MVEGA, JMALDONADO, JMAYTA). ALOPEZ la reparte en Permisos.

**Front.**

- Ingeniería › Tickets › **Boletas sin llenar** (primera del menú, con el número
  de hoy al lado): día, área, buscador, aviso de cuánto falta para el cierre
  (18:20), tarjetas por área (las que ese día no tienen tickets dicen "No se exige
  boleta"), lista por área con la tira de 11 días, "Nunca registró" / "Reincide",
  marcar o quitar el aviso y descarga en Excel.
- Supervisora › **BOLETAS** (al lado de ASISTENCIA, con el contador en rojo):
  lo mismo en tarjetas para el celular, con "Ya le avisé".
- El cálculo y los avisos están en `app.js` (`bolTira`, `bolAvisar`) para las dos.
- `dinamico.js`: la miga de pan toma solo el texto del menú, sin el contador.

## Verificar después de correrlo

```sql
select proname from pg_proc where proname in
  ('_boleta_estados','_boletas_areas','fn_boletas_sin_llenar','fn_boleta_avisar');   -- 4 filas
select count(*) from permisos_pestana where pestana = 'pasoBolSin';                  -- 5
```

Con los datos del 06-10 debe dar 22 sin boleta: ACABADO 3, CAMISA 5, PANTALÓN 8 y
SACO 6; CORTE, REPROCESO y UDP salen como "No se exige boleta".
