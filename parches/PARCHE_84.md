# PARCHE 84 — Tickets · RESUMEN X OPERARIO

> **Aplicado en producción el 23-set-2026**, con autorización de Ruzaad. Después
> de aplicarlo, `anon` y `authenticated` pueden ejecutarla, y una sesión inválida
> recibe `SESION_INVALIDA`. Ruzaad eligió el reparto proporcional para "vs meta".

## Para qué

Responder "¿qué hace cada operario en su día a día, dónde rinde mejor y dónde
rinde poco?". Es una vista de solo lectura en **Tickets > Actual**, al lado de
REPORTE DE HOY.

## Qué se ve

- **Rango de fechas.** Por defecto, los 5 últimos días laborales (lunes a
  viernes) que terminan hoy: si hoy es miércoles, desde el jueves anterior.
  Sábado o domingo solo salen como columna si alguien trabajó ese día.
- **Filtro de operario digitable** (nombre o DNI; sugiere mientras escribes),
  área y orden (más unidades, mayor/menor eficiencia, nombre).
- Una tarjeta por operario con sus unidades, operaciones, días y eficiencia del
  rango. Al abrirla, sus operaciones **sumadas sin distinguir OF**: unidades por
  día, total, días, und/día y la comparación. Se marcan la operación donde
  **▲ rinde más** y donde **▼ rinde menos**.
- **Comparación intercambiable sin recargar:**
  - **vs meta**: eficiencia en la operación. La base no guarda cuánto tiempo
    pasó en cada operación (los tickets se registran en tandas), así que el
    turno del día (575 + incidencias) se reparte entre sus operaciones según
    los minutos estándar que produjo en cada una.
  - **vs promedio**: sus unidades por día en la operación contra el promedio de
    todos los que la hicieron en el rango (100 % = igual). Si nadie más la hizo,
    sale "—".
- Respeta el botón **Censurar %** de Eficiencia.

## Qué cambia en la base

Solo agrega `fn_resumen_operario(p_dni, p_token, p_desde, p_hasta, p_area)`:

- Valida con `_ing` (cualquier usuario de INGENIERIA), igual que Tickets.
- Solo tickets ACTIVOS. Rango máximo 93 días.
- El disponible del día usa la misma regla que `fn_eficiencia_rango`: 575 +
  incidencias, 0 si faltó, y sábado/domingo solo si produjo. Por eso la
  eficiencia del rango de cada operario cuadra con la pestaña Eficiencia.
- Normaliza los nombres de operación (mayúsculas y espacios) para que
  "HABILITAR SACO (INGRESO )" y "(INGRESO)" se sumen juntas.

No cambia ninguna tabla ni otra función. Para deshacer:
`drop function public.fn_resumen_operario(text, uuid, date, date, text);`

## Cómo se probó

En producción, dentro de una transacción deshecha al final: 17 al 23-set-2026,
todas las áreas → 126 operarios, 480 operaciones, 0,4 s y 218 KB de respuesta.
La vista se revisó con esos datos en escritorio y en celular.
