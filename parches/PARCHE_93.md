# PARCHE 93 — Operario · Mi boleta (reemplaza "Mis registros")

## Qué ve el operario

En la pantalla de OF (costura y Acabado) hay un botón **MI BOLETA**. Abre una
matriz de días (lunes a domingo) y, debajo, la lista de días con su estado.
Solo dice **Entregado** o **Pendiente**; nunca la eficiencia.

- Rangos rápidos: esta quincena (por defecto), quincena anterior, este mes y
  mes anterior. También desde/hasta a mano (un solo día: misma fecha en los dos).
- "Solo mis días pendientes" deja solo los días que le faltan.
- Tocar un día en la matriz lleva a su fila con el detalle.

"Mis registros" de Acabado (parche 58) desaparece de la app. Su RPC
`fn_acabado_mis_registros` **se queda en la base**: los despliegues que aún no
se actualicen la siguen llamando.

## La regla (`fn_mi_boleta`)

| Estado | Cuándo |
|---|---|
| ENTREGADO | tiene tickets ACTIVOS ese día, o sus incidencias aprobadas (`ocurrencias`, sin horas extras) suman ≥ 575 min de descuento |
| AUSENTE | su asistencia del día no es ACTIVO (FALTA, DM, VACACIONES, LICENCIA, PH). Se muestra con ese nombre y no se le exige |
| SIN_LABOR | sábado o domingo sin tickets; día en que su área (actual u origen) no registró ningún ticket, es decir feriado o áreas sin tickets como CORTE y REPROCESO; o antes de su primer registro en el sistema |
| PENDIENTE | todo lo demás |

En un día pendiente, la fila explica por qué: sin tickets ni incidencia, una
incidencia que no cubre la jornada (p. ej. 200 min), o una incidencia aún por
aprobar.

Hoy cuenta como "sin labor" hasta que alguien de su área registra el primer
ticket del día, así que en la mañana no le aparece como pendiente.

Solo lectura. Rango máximo 62 días; la fecha final nunca pasa de hoy.

## Cómo se comprobó

- Con datos reales de septiembre (consulta de solo lectura en producción):
  BALLADARES (Acabado) sale ENTREGADO en los días de 575 min de descuento
  (Despacho, Liquidación…), PENDIENTE el 16, 17 y 21 de setiembre y el 1 de
  octubre, y FALTA el 18. En toda la planta: 303 días-persona pendientes entre
  52 personas; CORTE, UDP y REPROCESO salen sin labor.
- La función se creó y corrió en un Postgres 16 local con tablas mínimas.

## Rollback

```sql
drop function if exists public.fn_mi_boleta(text, uuid, date, date);
```
Sin la función, la pantalla dice "La boleta todavía no está disponible."
