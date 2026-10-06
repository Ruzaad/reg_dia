# PARCHE 95 — Permisos por área y pestaña

> **Sin aplicar.** Lo corre Ruzaad en el SQL Editor (`sql/parche_95.sql`).
> Vuelta atrás: `sql/parche_95_rollback.sql`.

## Qué cambia

Hasta ahora cualquier usuario con cargo INGENIERIA podía editar todas las áreas:
KROJAS podía cambiar tiempos de la base de CAMISA COSTURA, marcar asistencia o
resetear el PIN de un operario de camisas. Ahora:

- **El administrador maestro** (`operarios.es_admin`, hoy ALOPEZ) ve y edita
  todo, y reparte los permisos desde la pestaña nueva **Gestión › Permisos**.
- Cada usuario de oficina tiene, por área, **Sin acceso**, **Lectura** o
  **Edición**. "Todas las áreas" (`*`) vale también para las que se agreguen.
- Y una lista de **pestañas** que puede abrir. Las de Incentivos, Auditoría,
  Historial de tiempos y Permisos siguen siendo solo del administrador.
- Operarios y supervisoras no cambian: siguen atados a su área como antes.

## Cómo se hace cumplir

**Escritura.** `_auth` (y `fn_validar_ingenieria`) dejan en la transacción las
áreas que el usuario puede editar. Un trigger `perm_area_trg` en 15 tablas
revisa el área de cada fila que se inserta, cambia o borra:

| Tabla | Área que se mira |
|---|---|
| bases, reclamos, ocurrencias, solicitudes_ajuste, of_generada, of_troceo, operaciones_extra, ops_adicionales_of, modulos_cerrados, residuales, area_hora_declarada, areas_config | `area` |
| operarios | `area_origen` o `area_actual` |
| movimientos_area | `area_anterior` o `area_nueva` |
| asistencia | origen o actual del operario |

Basta con que una de las áreas de la fila sea editable: así LFABIAN puede
prestar a un operario de camisas a sacos y KROJAS puede marcar la asistencia
del prestado. Cada quien puede tocar su propia fila de `operarios` (sesión,
PIN). El trigger tiene un `WHEN` que lo salta entero si no hay restricción
(operarios, supervisoras, administrador, procesos del sistema), así que los 2
millones de UPDATE de `reclamos` al reclamar no pagan nada.

Al chocar, la RPC devuelve `NO_AUTORIZADA_AREA: solo lectura en CAMISA COSTURA`
y la app muestra "No tienes permiso: solo lectura en CAMISA COSTURA".

Esto también corrige el matiz conocido de las incidencias: corregir o eliminar
una ocurrencia ya no lo puede hacer cualquiera de INGENIERIA, solo quien edita
esa área.

**Lectura.** Las 36 RPC de lectura de Ingeniería (Base, tickets, ocurrencias,
asistencia, eficiencia, personal…) validan con `_lector(p_dni, p_token, p_area)`
en vez de exigir cargo INGENIERIA. Pasa el administrador o quien tenga Lectura
o Edición en esa área; área vacía ("Todas") exige permiso en `*`. Así un usuario
de otro cargo (Costos) puede leer lo que se le dé, sin un cargo fijo en el
código. Las RPC de escritura siguen exigiendo cargo INGENIERIA.

Las definiciones vivas se guardan en `parche95_respaldo` antes de cambiarlas;
el rollback las restaura tal cual.

## Permisos con los que arranca

| Usuario | Lee | Edita | Pestañas |
|---|---|---|---|
| ALOPEZ | todo | todo | todas |
| LFABIAN | todas | CAMISA COSTURA | las de hoy |
| KROJAS | todas | SACO COSTURA, PANTALON COSTURA | las de hoy |
| MVEGA y los inactivos de Ingeniería | todas | nada | las de hoy |

ACABADO, CORTE, REPROCESO y UDP solo las edita ALOPEZ hasta que las reparta.

## App

- `fn_mis_permisos` al entrar: se quitan del menú las pestañas no asignadas, los
  filtros de área solo muestran las áreas que puede ver ("Todas" solo si lee
  todas) y arranca en la primera área que edita.
- En Bases, Personal, Incidencias, Corregir fechas y Generar tickets, si el área
  elegida es de solo lectura sale un aviso y se esconden los botones de edición.
- Cualquier cargo que no sea OPERARIO, ESTAJERO ni SUPERVISORA entra por
  `ingenieria.html`. El administrador puede crear personal con cargo INGENIERIA o
  COSTOS (área INGENIERIA, que no aparece en las listas de áreas).
- Si la base aún no tiene el parche, `fn_mis_permisos` no existe y la app se
  comporta como antes.
- De paso: la barra "Edita las celdas y pulsa GUARDAR" de Bases se veía siempre
  (el `display:flex` le ganaba a `hidden`); ahora solo en modo edición.

## Lo que queda fuera

- `ofs` y `of_detalle` (hojas de numeración), `causas_std`, `tickets_visibilidad`
  y `motivos_cambio_fecha` no tienen área: los sigue editando cualquiera de
  INGENIERIA.
- La edge function `generar-tickets` (escribe al Sheet ALMACÉN, hoy apagado)
  solo revisa el cargo.
- Un usuario de Ingeniería nuevo entra sin permisos hasta que el administrador
  se los dé.
- Si el rollback se corre después de que otro parche use `_lector`, esas
  funciones dejarán de funcionar.

## Verificación hecha

En una base local con las tablas de producción y las 36 funciones con su misma
validación: el parche corre dos veces sin error, 26 casos (KROJAS no edita
CAMISA, sí SACO; LFABIAN presta a un operario; Costos lee solo su área y no
escribe; operarios y supervisoras sin cambios; ALOPEZ todo) y el rollback deja
las funciones como estaban.
