# Parche 150 — Borrar estajeros
Ruzaad pidió eliminar el cargo ESTAJERO y sus vistas (el front ya no las tiene desde el parche 149). Este SQL borra el único estajero (inactivo, sin tickets). Verificar: `select count(*) from operarios where cargo='ESTAJERO';` da 0.
