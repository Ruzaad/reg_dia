# PARCHE 90 — Personal que cambia de área en el día

> **Aplicado en producción el 30-set-2026**, con autorización de Ruzaad (despliegue conjunto).

## El problema

Los 575 min del día se reparten entre áreas con la **hora del movimiento**, y
esa hora casi nunca es la real. El movimiento lo crea el reclamo (parche 58) en
el momento en que el operario **registra**, que suele ser al almuerzo o a las
18:20. Quien a las 18:20 llena tickets de saco y luego de pantalón queda con
575 min en saco y 0 en pantalón.

En los últimos 30 días hubo 160 movimientos (95 días-persona), y 102 de ellos
tienen la hora del registro, no la del cambio.

## Qué cambia

**1. El operario dice desde qué hora está en el área nueva.** Al tocar otra
área en "¿En qué área vas a trabajar?", la app pregunta "¿Desde qué hora estás
en X?" (por defecto, la hora actual). Esa hora se guarda y el movimiento que
crea su primer reclamo en esa área la usa. Si ya lo había movido un reclamo,
corrige ese movimiento. No se acepta una hora futura ni una anterior a su
cambio previo del día.

**2. Cada movimiento guarda de dónde salió su hora** (`movimientos_area.origen`):

| Origen | Quién | ¿Fiable? |
|---|---|---|
| DECLARADO | el operario dijo la hora | sí |
| MANUAL | supervisora o ingeniería lo movieron (`fn_cambiar_area`) | sí |
| AJUSTADO | ingeniería corrigió la hora (`fn_movimiento_hora`) | sí |
| RECLAMO | hora en que registró | no |

Los movimientos que ya existen se clasifican solos: movido por otra persona es
MANUAL, hora exacta en minuto (así la deja `fn_movimiento_hora`) es AJUSTADO,
y el resto es RECLAMO.

**3. El reparto de los 575 min** (`_disp_reparto`, que ahora usan
`_disp_dia_areas` y `_disp_prorrateado`):

- **Por hora**: si todos los movimientos del día tienen hora fiable, igual que antes.
- **Por producción**: si alguno no la tiene, o produjo en varias áreas sin
  movimiento, los 575 min se reparten según los minutos producidos en cada área.
- Si no produjo ni se movió, la jornada es de su área actual, igual que antes.

La eficiencia del día (575 + incidencias, con la que se paga) **no cambia**.
Solo cambia cuántos de esos minutos cuenta cada área.

**4. Ingeniería → Personal → Movimientos** agrega dos columnas: "Hora de" (de
dónde salió la hora) y "Reparto" (por hora o por producción). El resumen dice
cuántas personas del día se reparten por producción. Al corregir la hora y
guardar, ese día pasa a repartirse por hora.

**5. Avisos.** El aviso de cambio de área dice "dice que está ahí desde las
HH:MM" o "sin decir desde qué hora".

## Cómo se comprobó

Contra producción, dentro de un bloque que se deshace solo al final (no quedó nada aplicado):

- Últimos 30 días: el total repartido es el mismo (2 086 100 min) y cada
  persona sigue sumando 575. Cambian 208 días-persona.
- Ejemplo del 28 set: una persona tenía 575 en pantalón y 0 en acabado,
  aunque produjo 312,6 min en acabado. Ahora queda con 321,8 en acabado y 253,2 en pantalón.
- Flujo completo con un operario de prueba: declara las 10:00 → reclama en
  pantalón → movimiento DECLARADO a las 10:00 → corrige a 10:30 → 139 min en saco
  y 436 en pantalón, repartido por hora. Una hora futura se rechaza.
- `fn_movimientos_listar` devuelve `origen` y `modo`.

## Lo que queda fuera

- La hora de entrada temprana (antes de las 08:00) se toma como 08:00: el turno
  sigue siendo 08:00 a 18:20.
- El estajero no tiene área propia y no entra en el reparto; no se le pregunta.
- Ninguna RPC vieja cambia de firma. Si un despliegue aún no tiene la app nueva,
  sus cambios de área quedan como RECLAMO y se reparten por producción.

## Deshacer

`sql/parche_90_rollback.sql` restaura `_disp_dia_areas` y `_disp_prorrateado`
tal como estaban. Lo demás puede quedarse.
