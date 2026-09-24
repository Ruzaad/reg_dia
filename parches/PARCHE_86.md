# PARCHE 86 — Ingeniería · HISTORIAL DE TIEMPOS DE BASE (solo ALOPEZ)

> **Aplicado en producción el 24-set-2026**, con autorización de Ruzaad.

## Para qué

Saber quién cambia los tiempos STD de la BASE, cuándo, en qué artículo y
operación, y cuánto cambió.

## Qué se ve (ingenieria.html)

Gestión → **Historial de tiempos**, solo para el maestro (`es_admin`, hoy
ALOPEZ; a los demás no les aparece y la función les responde NO_AUTORIZADA).
Filtros Desde/Hasta/Área (consultan) y Usuario/Buscar (al instante), KPI de
cambios, usuarios, artículos, STD bajados y subidos, tabla y descarga XLSX.

## Qué cambia en la base

- Tabla `bases_log` (RLS activo, sin acceso para `anon`/`authenticated`).
- Trigger `bases_log_trg` en `bases` (después de insertar, borrar o cambiar
  `std`): anota EDITADO (STD antes y después), AGREGADA o BORRADA. Un update
  que no cambia el STD no anota nada (la renumeración de N° OP no ensucia).
- `_ing` y `fn_validar_ingenieria` dejan el usuario en `app.dni` solo para esa
  transacción. Las 8 funciones que escriben en `bases` pasan por una de las
  dos, así que no se tocó ninguna. Lo que se escriba por fuera de la app queda
  como `SISTEMA`.
- `fn_bases_log(dni, token, desde, hasta, area)`: valida con `_admin`; rango
  máximo 6 meses.

Solo registra desde que se aplica. Una subida de Excel que borra o agrega
operaciones deja una fila por operación.

Para deshacer: `sql/parche_86_rollback.sql` (borra también el historial).

## Cómo se probó

En producción dentro de una transacción que siempre se deshace: un cambio de
STD después de `fn_validar_ingenieria('LFABIAN')` quedó como LFABIAN; una
operación agregada después de `_ing('ALOPEZ')` quedó como ALOPEZ; sin sesión,
SISTEMA; un update sin cambio de STD no anotó nada; `fn_bases_log` con
LFABIAN → NO_AUTORIZADA.
