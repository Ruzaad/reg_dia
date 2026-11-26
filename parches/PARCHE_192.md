# Parche 192 — Paquetes ajustados visibles en la operación

**Problema:** al ajustar un paquete (hizo 2 de 10), el operario veía en la operación el paquete original de 10 «tomado» y nunca el 2 ni el 8 del resto.

**Cambio:** `fn_reclamados` agrega `cant`, `asig` y `padre` (solo campos nuevos). El celular muestra «Hizo 2 de 10 und · Apellido» y debajo «Resto 8 und · Apellido».

**Verificar:** OF 9874 · CERRAR HUEQUITO, paquete 341-350: «Hizo 2 de 10» y «Resto 8».
