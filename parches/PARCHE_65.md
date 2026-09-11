# PARCHE 65 — Fix: timeout al generar tickets (regresión del parche 62)

## Reporte del usuario
"Intento generar tickets y me sale que servidor statement timeout, no puedo
generar tickets" (probado desde ingeniería; no probado aún desde operario).

## Causa raíz (confirmada en logs, no es especulación)
El parche 62 agregó `perform fn_tickets_cache_refrescar(p_area)` a
`fn_of_generar` y a las funciones de `bases` para invalidar la caché de
tickets. El problema: esa versión recalculaba **toda el área** (hasta
37,531 filas en CAMISA COSTURA) por cada cambio, aunque solo hubiera
cambiado una OF o un artículo — medido en vivo: **4.5 segundos**.

El rol `anon` (con el que corre la sesión de ingeniería, porque la app usa
la anon key directo y no Supabase Auth) tiene `statement_timeout = 3s`. Se
confirmó en los logs de Postgres:

```
canceling statement due to statement timeout   2026-09-11 21:41:57
canceling statement due to statement timeout   2026-09-11 21:42:05
canceling statement due to statement timeout   2026-09-11 21:42:18
```

Y en los logs de la API, 3 llamadas a `fn_of_generar` devolviendo `500` en
~3.2s cada una, justo en el momento reportado.

## Fix
1. `fn_tickets_cache_refrescar(p_area, p_of default null)` — ahora acepta
   un OF opcional (reusa el parámetro que `fn_tickets_of_raw` ya tenía).
   Medido: refrescar una sola OF toma **~150ms** en vez de ~4.5s.
2. `fn_tickets_cache_refrescar_articulo(p_area, p_articulo)` — nueva.
   Refresca solo las OF generadas de ese artículo (loop por OF). Medido en
   el artículo con más OF generadas hoy (7): **~700ms**.
3. Cada función de escritura (`fn_of_generar`, `fn_of_registrar`,
   `fn_base_articulo_eliminar`, `fn_base_articulo_guardar`,
   `fn_base_op_crear`, `fn_base_op_editar`, `fn_base_op_eliminar` ×2,
   `fn_bases_subir`) ahora llama a la versión más angosta posible (por OF o
   por artículo) en vez de refrescar el área entera.
4. Como colchón adicional, se les agregó `SET statement_timeout TO '30s'`
   (igual que ya tenía `fn_tickets_area`) — son acciones de ingeniería, no
   de alto tráfico como las del operario, así que 30s es razonable incluso
   si algún caso futuro resulta más pesado de lo medido hoy.

## Verificación hecha
- `fn_tickets_cache_refrescar('CAMISA COSTURA','10185')` con
  `statement_timeout='3s'` simulando el rol `anon`: **147ms**, sin error.
- `fn_tickets_cache_refrescar_articulo('CAMISA COSTURA','ML1022')` (el
  artículo con más OF generadas, 7): **694ms**.
- Conteo de `tickets_cache` por área antes/después: igual
  (37,531 / 26,045 / 53,194) — no se perdió ni duplicó nada.
- No se probó `fn_of_generar` de punta a punta sobre una OF real porque las
  41 OF ya generadas tienen reclamos activos (la función se niega a
  regenerar troceo con reclamos activos, por diseño) — hacerlo con una OF
  nueva real habría alterado datos de producción reales para la prueba.
  La pieza que fallaba (el refresco de caché) quedó verificada por
  separado, con tiempos muy por debajo de los 3s/30s de margen.

## Riesgo / rollback
Mismo patrón aditivo que el parche 62 — no se borró nada. Si aparece un
caso donde el refresco por artículo siga siendo lento (un artículo con
muchísimas OF generadas a la vez), el margen de 30s en las funciones de
ingeniería debería cubrirlo; si no alcanza, el siguiente paso sería mover
el refresco fuera de la transacción (ej. un job asíncrono) en vez de
seguir ampliando el timeout.
