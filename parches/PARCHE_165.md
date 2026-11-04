# Parche 165 — Acabado por OF en prendas (Cronogramas)

**Problema:** el gráfico "Acabado por OF" comparaba minutos de Acabado contra minutos de lo que costura entregó solo dentro del rango de fechas; en ternos mezclaba saco y pantalón y daba porcentajes absurdos (OF 10188: 459 %).

**Cambio:** nueva RPC `fn_pcp_cronos_prendas(p_dni, p_token, p_desde, p_hasta)`. Por OF y prenda (saco / pantalón / camisería) devuelve, acumulado hasta `p_hasta`: prendas entregadas por costura (penúltima operación), prendas terminadas por Acabado (penúltima operación de Acabado de esa prenda), y la cantidad de la OF. `fn_pcp_cronos` no se toca. En el front, el Gantt usa la nueva RPC y cae a minutaje si el parche no está.

**Verificar:** en Cronogramas › Acabado por OF aparece "en prendas"; la OF 10188 muestra Saco: Acabado 806 de 1 003 (80 %), costura 540. Medido en producción: ~1,1 s.

**Rollback:** `sql/parche_165_rollback.sql`.
