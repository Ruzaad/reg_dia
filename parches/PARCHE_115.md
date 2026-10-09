# PARCHE 115 — Paquetes sueltos sin reclamar

## El problema
Hay paquetes que nadie reclama en OFs que ya avanzaron: la OF se queda
parada en el área o una operación sigue con los paquetes de después y deja
atrás algunos. Hoy no hay dónde verlos; aparecen recién cuando ACABADO ya
registró la OF y los minutos no cuentan para nadie.

## El cambio
- **Ingeniería › Tickets › Paquetes sueltos**: tarjetas por área, una fila por
  OF con su estado (parada desde, o en curso con hueco desde), si ACABADO ya
  la registró, paquetes, minutos, operaciones, por qué está suelto y días
  hábiles. Filtros por antigüedad, motivo y OF/artículo; descarga en Excel.
- **Ver** abre la OF por operación: qué paquetes faltan (en rangos), quién
  registró la mayoría de esa operación en esa OF (solo como pista) y la lista
  para copiar a WhatsApp.
- **Supervisora** (Más › Paquetes sueltos): lo mismo de su área en tarjetas,
  con la lista para WhatsApp.
- Se reparte por área en Gestión › Permisos (pestaña Paquetes sueltos; quien
  ya tiene Auditoría también la ve).

## Cuándo sale una OF
- **Parada**: 7 días hábiles sin ningún reclamo en el área. Cuentan todos sus
  paquetes libres de operaciones que ya empezaron en el área.
- **En curso con hueco**: una operación registró paquetes posteriores hace 3
  días hábiles o más y dejó atrás algunos.
- Motivo: saltado; operación que nadie registró en esa OF (sí en otras); u
  operación que nadie registra en ninguna OF en 60 días (revisar BASE).
- No cuentan ACABADO, los módulos cerrados ni OFs sin reclamos en 120 días.

## Base (`sql/parche_115.sql`)
Solo lectura, sin tablas nuevas. Nuevas: `_dias_hab`, `_sueltos_areas`,
`_sueltos`, `fn_paquetes_sueltos` y `fn_paquetes_sueltos_of`. Probado en
lectura contra producción: todas las áreas en unos 3 s; una OF al instante.
Sin el parche, la pantalla avisa que falta correrlo.
Rollback: `sql/parche_115_rollback.sql`.
