# Parche 175 — Incidencias de Ingeniería alineadas con el operario

**Problema:** al crear una incidencia en Ingeniería faltaban los tipos y tiempos nuevos del operario; el área salía de dónde se registró y no de la estructura; rechazar un pedido obligaba a escribir motivo.

**Cambio:** `fn_ocurrencias_listar` trae `area_est` (estructura del mes) y filtra por ella; `fn_solicitud_borrar` quita un pedido pendiente o rechazado sin motivo ni aviso. Front: el modal usa los tipos del operario (incl. «Trabajé en otra área», causa y OF en Reprocesos) y sus atajos de tiempo; botón Borrar junto a Rechazar. Supervisora: «Pedidos» pasa a la barra de abajo y sale de «Más».

**Verificar:** Incidencias › Aplicadas muestra el área de la estructura; Por aprobar › Borrar no pide motivo.

**Deshacer:** `sql/parche_175_rollback.sql`.
