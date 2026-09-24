# PARCHE 87 — Ingeniería · HORAS EXTRAS EN LOTE

> **Aplicado en producción el 24-set-2026**, con autorización de Ruzaad.

## Para qué

Registrar las horas extra de varias personas de un área a la vez, para un día
cualquiera.

## Qué se ve (ingenieria.html)

Incidencias → **HORAS EXTRAS EN LOTE**. Se elige día, área y motivo (por
defecto "HORAS EXTRAS"). Las horas por defecto son 2 y se cambian de media en
media hora; "Aplicar a todos" devuelve a todos a ese valor. Cada persona tiene
su propio − / + (de 0,5 a 12 h). Quien ya tiene horas extra ese día muestra un
aviso con el total en que quedaría; quien no estuvo activo (FALTA, DM,
VACACIONES…) no se puede marcar. Abajo, el total de personas y horas, y el
botón para registrar, que pide confirmación.

## Qué cambia en la base

Solo agrega `fn_he_lote_personal(dni, token, area, fecha)` (valida con `_ing`):
el personal del área con su estado ese día y las horas extra que ya tiene.
`fn_personal` no servía porque siempre mira el estado de hoy.

El registro usa `fn_ocurrencia` tal como está (tipo HORA_EXTRA), una llamada
por cada cantidad distinta de minutos; si alguien no estuvo activo ese día la
función lo salta y lo avisa.

Para deshacer: `drop function public.fn_he_lote_personal(text, uuid, text, date);`

## Cómo se probó

SACO COSTURA, día anterior: 35 personas en 133 ms, 1 ausente, 2 con horas
extra. En pantalla, 3 personas con 2 h, 2,5 h y 2 h generan dos llamadas
(120 min para dos DNI y 150 min para uno), sin desborde a 1366, 1100 y 390 px.
