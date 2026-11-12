# Parche 177 — Inicio: ver un mes anterior sin recalcular

**Problema.** Al elegir un mes pasado en el Inicio, `fn_inicio_mes` recalculaba todo el mes con `_pcp_prod` (≈1 s; con la planta cargada se acerca a los 3 s del rol `anon`) y lo repetía por cada fecha distinta.

**Cambio.** `fn_inicio_mes` (misma firma): si el mes ya está en `inicio_mes_cerrado` hasta el día anterior a la fecha pedida, copia esos minutos al caché sin llamar a `_pcp_prod`. El front (`inicio.js`) pide ahora el último día del mes (31-oct → cerrado hasta el 30). Sin cambios de tablas.

**Verificar.** En el Inicio, elegir «Ver mes» octubre: debe mostrar 973 606 min a la fecha (suma de `inicio_mes_cerrado` 2026-10 + lo del 31) y cargar al instante.
