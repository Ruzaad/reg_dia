# Parche 139 — Permisos y seguros sin el refrigerio, y cantidad en Costos › Reporte de hoy

## Problema
1. `_min_salida` contaba de la hora de salida a las 18:20 sin quitar el refrigerio (13:00 a 13:45). Una salida a las 08:00 sin retorno descontaba 620 min, cuando la jornada es de 575.
2. Se aceptaba una salida fuera del horario. Una salida a las 00:45 se tomaba como 08:00 y descontaba el día entero.
3. Costos pidió ver la cantidad en el Reporte de hoy.

## Cambio
- `_min_salida`: misma firma. Ajusta salida y retorno a 08:00–18:20 y quita el cruce con 13:00–13:45, así que nunca pasa de 575.
- `fn_ocurrencia_salida`: misma firma. Rechaza una salida antes de las 08:00 o desde las 18:20.
- Recalcula las salidas guardadas que tenían el cálculo viejo. En producción son 3 (por ejemplo, el id 2857 pasa de −620 a −575). Las que alguien corrigió a mano no se tocan.
- `fn_costos_reporte_dia`: misma firma. Agrega `cant_of` (la cantidad programada de la OF) en `tickets` y `cant` (las prendas que registró la persona en esa área) en `personal`.
- Front:
  - En `app.js`, la supervisora ve el descuento ya sin el refrigerio y no puede guardar una salida fuera del horario.
  - En `costos.js`, se agregan las columnas «Cant. OF» y «Cantidad» en la pantalla y en el Excel.

## Verificar
```sql
select _min_salida('08:00', null, false);   -- 575
select _min_salida('12:00', '14:00', true); -- 75
select minutos from ocurrencias where id = 2857; -- -575
```

## Deshacer
Correr `parche_139_rollback.sql`. Los minutos recalculados no se devuelven al valor anterior.
