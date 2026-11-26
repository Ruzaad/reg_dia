# Parche 191 — El N°OP del ticket se corrige solo al reclamar

**Problema:** un ticket reclamado con el N°OP viejo (del troceo, tras renumerar la BASE) no contaba en las tarjetas de última/penúltima: CERRAR HUEQUITO quedó con N°119 en vez de 126 (tarjeta 94, resumen 95).

**Cambio:** `_reclamo_op_id` (trigger BEFORE INSERT de reclamos) fija el N°OP al vigente de la BASE cuando la operación (op_id y nombre) coincide. Una búsqueda por índice único; no cambia la firma de ninguna RPC. También corrige los 7 tickets de noviembre ya desfasados.

**Verificar:** reclamar una operación con N°OP viejo y ver su N°OP igual al de la BASE; `quedan_desfasados` = 0.
