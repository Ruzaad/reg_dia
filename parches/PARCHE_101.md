# PARCHE 101 — Auditoría, Incentivos e Historial de tiempos se dan por área

> **Sin aplicar.** Lo corre Ruzaad en el SQL Editor (`sql/parche_101.sql`).
> Vuelta atrás: `sql/parche_101_rollback.sql`.

## El problema

En Gestión › Permisos no salían las pantallas que solo veía ALOPEZ, así que no
se podían delegar a los analistas. Sus RPC validaban con `_admin`:

| Pantalla | RPC |
|---|---|
| Auditoría (`pasoAudit`) | fn_ef_auditoria, fn_ef_auditoria_v2, fn_ef_auditoria_detalle, fn_ef_auditoria_ops |
| Incentivos (`pasoInc`): quincena, tabla, bono modular, eficiencia manual, min. consideración | fn_incentivos_quincena, fn_incentivos_tabla_listar, fn_bono_modular_tabla_listar, fn_bono_modular_listar, fn_bono_modular_guardar, fn_bono_modular_override, fn_ef_manual_listar, fn_ef_manual_guardar, fn_ef_tickets_rango, fn_consideracion_listar, fn_consideracion_guardar, fn_consideracion_eliminar |
| Historial de tiempos de BASE (`pasoBaseLog`) | fn_bases_log |
| Permisos (`pasoPermisos`) | fn_permisos_listar, fn_permisos_guardar (siguen solo del administrador) |

Además, corregir o eliminar una incidencia (fn_ocurrencia_editar y
fn_ocurrencia_eliminar, que se usan desde Auditoría e Incidencias) validaba con
`_ing`: cualquier usuario de INGENIERIA.

## El cambio

**Base (`sql/parche_101.sql`).**

- `_vista(dni, token, pestañas, área)`: el administrador pasa siempre; los demás
  necesitan una de esas pestañas en `permisos_pestana` y leer el área en
  `permisos_area` (`''` = todas, exige `*`, igual que `_lector`).
- `_vista_area(usuario, áreas, editar)`: para lo que se toca por persona o por
  fila. Leer pide acceso a alguna de las áreas; editar pide nivel EDITAR.
- Las 12 RPC de lectura solo cambian su primera línea (`perform _admin(...)`),
  y el parche la reemplaza sobre la definición que ya está en la base. El
  detalle de Auditoría mira el área de origen o la actual de la persona.
- Las RPC que escriben revisan el área de cada fila: bono modular por el área,
  eficiencia manual, minutos de consideración y la excepción del modular por el
  área de **origen** de la persona (la misma con que agrupa Incentivos).
- Incidencias: hace falta la pestaña Incidencias o Auditoría y editar el área
  de la incidencia; si se cambia de persona, también el área nueva.
- `correcciones_log` y su trigger guardan cada cambio que hace un usuario de
  oficina en ocurrencias (cambios y borrados), eficiencia_manual,
  minutos_consideracion, bono_modular_dia y bono_modular_override: quién,
  cuándo, área, persona, día, antes y después. Operarios y supervisoras no se
  registran.
- `fn_correcciones_listar` (solo administrador) junta ese registro con
  `bases_log` (cambios de STD del parche 86).

**Front.**

- Auditoría, Incentivos e Historial de tiempos salen en el modal de Permisos
  para marcarlas como cualquier otra pestaña. Permisos y la nueva Correcciones
  siguen solo para el administrador.
- En esas pantallas, quien no lee todas las áreas no tiene "Todas las áreas";
  Incentivos le pide la quincena de su área en vez de toda la planta.
- Pestaña nueva **Gestión › Correcciones** para ALOPEZ: por defecto muestra a
  los analistas (lo suyo queda en "Todos"), con filtro por usuario y por tipo,
  y descarga en XLSX.

## Cómo se comprobó

Postgres 16 local con las tablas de permisos y las funciones de escritura tal
como están en producción (las de lectura como esqueleto con la misma primera
línea):

- LFABIAN (lee todas, edita CAMISA, con Auditoría e Incentivos): ve Auditoría
  de todas; guarda eficiencia manual, bono modular y consideración de CAMISA;
  en SACO recibe "solo lectura en SACO COSTURA"; no abre Historial de tiempos.
- Corrige una incidencia de CAMISA; la de SACO y pasar una de CAMISA a una
  persona de SACO se rechazan.
- KROJAS sin la pestaña: Auditoría y eliminar incidencias dan NO_AUTORIZADA.
- Un usuario COSTOS que solo lee CAMISA: la quincena de "todas" se rechaza, la
  de CAMISA sale; no puede guardar consideración; no ve el detalle de una
  persona de SACO.
- ALOPEZ hace todo; Permisos y Correcciones siguen negados a los demás.
- `correcciones_log` quedó con las 6 correcciones esperadas.
- El parche corre dos veces sin error, el rollback deja las 13 funciones con
  `_admin`/`_ing` como antes, y el parche se vuelve a aplicar encima.
