# Parche 190 — Error «cannot execute UPDATE in a read-only transaction»

**Problema:** al abrir el detalle «Avance de costura» (PCP › Cronograma) salía «Servidor: cannot execute UPDATE in a read-only transaction». La función estaba STABLE y llama a `_auth`, que renueva el token de sesión con un UPDATE; falla cuando la sesión toca renovarse (por eso solo pasa a veces). Igual en otras 21 funciones de lectura.

**Cambio:** `alter function … volatile` para las 22. No cambia cuerpos ni firmas. Los parches 187 y 188 ya no las declaran STABLE.

**Verificar:** `select proname from pg_proc where provolatile='s' and proname like 'fn\_%' and prosrc ilike '%_lector(%'` no devuelve nada; abrir un Avance de costura.
