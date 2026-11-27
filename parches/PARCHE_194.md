# Parche 194 — Acabado: terno con un solo número de OF

**Problema:** tras el parche 176, la OF 9874 (terno TE5246, prenda SACO) solo recibía operaciones de saco y Acabado no podía notificar los pantalones.

**Cambio:** `fn_acabado_ofs` aplica el filtro por prenda solo si el artículo tiene OF de más de una prenda (TXI034: 10688 SACO y 10689 PANTALON). Con una sola OF para el terno, recibe todas las operaciones.

**Verificar:** Acabado, OF 9874: salen las operaciones de saco y de pantalón; OF 10689 (TXI034): solo pantalón.
