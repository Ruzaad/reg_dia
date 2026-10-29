# Parche 148 · Inicio de Ingeniería: prendas registradas

**Problema.** El nuevo Inicio de Ingeniería (medidor de eficiencia de planta, tarjetas de minutos, prendas, personal y por confirmar) necesita las prendas del día, que ninguna RPC daba sin bajar los tickets.

**Cambio.** `fn_inicio_prendas(p_dni, p_token, p_fecha)`: prendas por área de un día, contadas por la penúltima operación del artículo (`_pcp_prod`, parche 147). Requiere el 147. Sin este parche, la tarjeta de prendas muestra «falta el parche 148» y el resto del Inicio funciona igual.

**Cómo verificar.** `select fn_inicio_prendas('ALOPEZ', '<token>'::uuid, current_date);` y abrir Ingeniería › Inicio.

**Deshacer.** `sql/parche_148_rollback.sql`.
