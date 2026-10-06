# PARCHE 97 — Asistencia: "EN <área>" (vino, pero apoya en otra área)

## Qué cambia para el usuario

La asistencia suma nueve variables para quien **sí vino** pero trabaja fuera de su
área de origen:

EN ACABADO · EN SASTRERIA (UDP) · EN CAMISAS · EN SACOS · EN PANTALON ·
EN REPROCESO · EN DESPACHO · EN ALMACEN · EN CORTE

- **Supervisora (Asistencia):** al tocar a una persona, las variables salen en un
  grupo aparte, "Vino, pero apoya en otra área", en violeta. La fila queda
  marcada en violeta (no ocre como una ausencia) y el contador dice
  `N activo(s) · N en otra área · N ausente(s)`. No se ofrece la variable de su
  propia área (a la de CAMISA COSTURA no le sale EN CAMISAS).
- **Ingeniería (Matriz y Estados por rango):** los desplegables agrupan
  Ausencia / Apoyo en otra área. En la matriz la variable se ve en violeta.
- **Ingeniería (Tableros · Asistencia):** "Presentes hoy" los cuenta como
  presentes, sale un KPI nuevo "De ellos, en otra área" y la torta los muestra
  aparte, en tonos violeta. No aparecen en Alertas.

## La regla

| | ACTIVO | EN <área> | FALTA, DM, VACACIONES, LICENCIA, PH |
|---|---|---|---|
| Cuenta como presente (tableros, % por área) | sí | **sí** | no |
| Minutos exigidos en su área (eficiencia) | 575 | **0** | 0 |
| Incentivo de ese día | según eficiencia | sin porcentaje (como licencia) | FALTA anula la quincena |
| Mi boleta del operario | se exige | no se exige | no se exige |

`_ausente()` no cambia: para la eficiencia, quien está en otra área no tiene
minutos exigidos (lo mismo que hoy se hace con una incidencia de 575 min por
Despacho). Si la persona va a **producir con tickets** en otra área, lo correcto
sigue siendo el cambio de área (parche 90), que reparte sus minutos; la app avisa
si se marca "EN <área>" a alguien que ya reclamó tickets ese día.

## Base de datos (`sql/parche_97.sql`)

- `estados_asistencia`: 9 filas nuevas (todas empiezan con `EN `).
- `_presente(estado)`: nueva, ACTIVO o `EN %`.
- `fn_asistencia_areas`: EN <área> suma a activos, no a excusados.
- `fn_asistencia_dashboard`: EN <área> cuenta en presentes (por día y hoy), no
  sale en alertas; clave nueva `hoy_otra_area`.

Compatibilidad: ninguna firma cambia. El front viejo (Netlify / GitHub Pages sin
actualizar) recibe las variables nuevas en su lista de estados y las puede
marcar; solo no las agrupa ni las pinta en violeta. La clave nueva del tablero la
ignora.

Rollback: `sql/parche_97_rollback.sql` (los días marcados "EN <área>" pasan a
ACTIVO, se borran los 9 estados y vuelven las dos funciones anteriores).

## Cómo se comprobó

En un Postgres 16 local con las definiciones de producción: con D4 "EN ACABADO",
el tablero de CAMISA COSTURA sigue en 3 presentes (antes del parche lo contaba
ausente), `hoy_otra_area` = 1, las alertas solo traen VACACIONES y FALTA. El
parche corre dos veces sin error y el rollback deja todo como estaba.
