# Parche 138 — Costos › Reporte de hoy con todo lo que pasa por producción

**Problema:** Costos necesita ver, por día, dónde trabajó cada persona según la estructura del mes, y la producción por OF, artículo y prenda con su S.A.M y su detalle por operación. `fn_costos_reporte` solo traía los tickets agrupados y no decía dónde trabajó la gente.

**Cambio:** se agrega la RPC `fn_costos_reporte_dia(p_dni, p_token, p_fecha, p_area)`, de solo lectura (`_lector`). Devuelve:
- los tickets por área, artículo, OF, operación, con su STD, cantidad, minutos y personas;
- la última y penúltima (`_ultimas`, parche 125) y el S.A.M de cada artículo en su área;
- el personal con tickets: área de la estructura del mes (si falta, `area_origen`), área donde trabajó, minutos producidos y jornada asignada;
- las personas de la estructura por área y las incidencias del día.

La jornada sale de `_disp_reparto`, la misma regla de la eficiencia. Si alguien solo tiene tickets en otra área, su jornada va completa a esa área. Si registró en dos, se reparte según lo producido, o según la hora del cambio de área cuando la supervisora la marcó.

`fn_costos_reporte` no cambia: la siguen usando los despliegues viejos.

**Front:** `ingenieria.html` (pasoCostosHoy), `costos.js` y `rediseno.css`.
- Pestañas de operación: según el área, última o penúltima.
- Tablas: por área, personal fuera de su área, producción por OF (se despliega por operación) e incidencias, que se filtran con o sin horas extra.
- La OF se muestra en el formato de Costos: 4 + ceros + la OF de planta, 10 dígitos en total (9817 → 4000009817).
- El Excel trae 4 hojas.

**Verificar:** en Costos › Reporte de hoy, elegir el 15/10/2026. En la tabla de personal fuera de su área deben salir CHOQUE MARTINEZ y PEREZ FLORES, de ACABADO, con la jornada completa en SACO. Medido en producción: unos 0.5 s con todas las áreas.

Rollback: `parche_138_rollback.sql`.
