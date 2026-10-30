# Parche 157 — Inicio: apoyo recibido por área

**Problema:** la tarjeta de cada área no decía cuánta producción del día vino de gente de otra área.

**Cambio:** `fn_inicio_resumen` (misma firma) agrega `apoyo_min` y `apoyo_pers`: minutos y personas MOD cuya área de estructura es otra y reclamaron tickets ACTIVOS en esta área ese día. Front: caja "Apoyo" en lugar de Min/prenda; botón Guardar de Corte con el estilo del sistema.

**Verificar:** el 29-oct-2026 da Camisa 278 min · 1 persona y Saco 2 732 min · 6 personas.
