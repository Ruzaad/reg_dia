# Parche 193 — Paquetes ajustados en la operación (OF del sistema)

**Problema:** el parche 192 solo completó `fn_reclamados`; las áreas sin almacén (SACO, PANTALON, CAMISA) cargan lo reclamado con `fn_tickets_of` y seguían viendo solo «10 und · Tomado por».

**Cambio:** `fn_tickets_of` agrega `cant`, `asig` y `padre` a `reclamados` (solo campos nuevos). El front (PR #184) ya los usa.

**Verificar:** OF 9874 · CERRAR HUEQUITO, paquete 341-350: «Hizo 2 de 10» y «Resto 8».
