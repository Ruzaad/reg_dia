# PARCHE 96 — Pantalla de Costos (solo lectura)

> **Requiere el parche 95** (permisos por área y pestaña). El SQL se niega a
> correr si `_lector` todavía no existe.

## Qué se ve

Grupo nuevo **Costos** en la barra de Ingeniería, con cuatro pestañas. Ninguna
tiene botones que escriban: solo filtros y descargas. Todas usan la barra de
fecha y área del rediseño.

| Pestaña (`data-tab`) | Qué muestra |
|---|---|
| Base y balance (`pasoCostosBase`) | La BASE del área con los mismos filtros que Bases (artículo, prenda, cliente, módulo, operación). Vista **Balance por artículo**: una ficha por artículo con el formato de la hoja de balance de línea (Meta, Horas disp., Pers. disp., Eficiencia, S.A.M, PPH, PxH, H. Req., N° Pers, subtotal por bloque y tiempo estándar de prenda). Vista **Tabla**: la base plana, con ★ en la última y penúltima. Descarga en **PDF** (una página A4 horizontal por artículo) y en **Excel** (una hoja por artículo, con fórmulas: cambiar Meta, Horas o Eficiencia en el Excel recalcula todo). Hasta 80 artículos por descarga. |
| Reporte de hoy (`pasoCostosHoy`) | Tickets activos del día en la última o penúltima operación, por OF, más las incidencias del día. **Según el área** (por defecto) toma la penúltima en CAMISA COSTURA y la última en el resto; se puede forzar Última o Penúltima. Descarga Excel. |
| Incidencias (`pasoCostosInc`) | Incidencias del rango por área, con minutos a favor y en contra, conteo por tipo, filtro por tipo y buscador. Descarga Excel. |
| Asistencia (`pasoCostosAsis`) | Personal del día por área de origen con su estado; presentes, sin marcar y una tarjeta por cada estado. Con "Todas las áreas", resumen por área. Descarga Excel. |

### Cálculo del balance

Igual que las hojas de ingeniería que se usaron de modelo (2FZ863 SALIM,
TE5247 GIOVANNI II, 3LS002 MARTIN):

- PPH = 60 / S.A.M
- PxH = PPH × eficiencia
- H. Req. = Meta / PxH
- N° Pers = H. Req. / Horas disp.
- Pers. disp. = N° Pers total redondeado hacia arriba

Meta, Horas disp. y Eficiencia son parámetros del cálculo (por defecto 1400,
9.57 y 80%). No se guardan en la base; el navegador recuerda los últimos usados.
En ACABADO los bloques son por prenda (ACABADO PANTALON, ACABADO SACO); en
costura, por módulo. El N° de cada operación es su N° OP de la base.

### Asistencia: quién cuenta como presente

ACTIVO y cualquier estado que empiece con **"EN "** (EN ACABADO, EN SACOS…, las
variables nuevas de asistencia que lleva otro hilo): vino y está apoyando en
otra área. Con al menos un ticket del día cuenta como ACTIVO aunque tenga otra
marca (misma regla que la lista de marcar). Sin marca ni tickets queda como
**Sin marcar**, aparte. Un estado nuevo aparece solo como tarjeta y columna.

## Base de datos

Cuatro RPC nuevas, solo lectura, validan con `_lector(p_dni, p_token, p_area)`
(parche 95): pasa el admin o quien tenga LEER/EDITAR en esa área; área vacía
(todas) exige permiso en `'*'`.

| RPC | Devuelve |
|---|---|
| `fn_costos_base(dni, token, area)` | La base del área (sin `subido_por`). |
| `fn_costos_reporte(dni, token, fecha, area)` | Tickets ACTIVOS del día sumados por área, artículo, OF, operación y N°OP; la última y penúltima N°OP de cada artículo según su base; incidencias del día. |
| `fn_costos_incidencias(dni, token, area, desde, hasta)` | Incidencias del rango (máx. 93 días). |
| `fn_costos_asistencia(dni, token, area, fecha)` | Operarios activos por área de origen con estado efectivo, marca guardada, tickets y área actual. |

No se toca ninguna RPC existente ni ninguna tabla.

## Cómo se probó

- El SQL corrió en un Postgres 16 local con las tablas mínimas y un `_lector`
  de prueba: las cuatro funciones devuelven lo esperado, agrupan artículos con
  espacios o minúsculas distintos, el ticket LIBERADO no cuenta, y un
  NO_AUTORIZADA de `_lector` sale como error (no como `ok:false`).
- La consulta de última/penúltima se midió en producción (solo lectura) para el
  05-10: 337 ms con 2 256 tickets y 22 artículos.
- Las pestañas se probaron en el navegador con datos reales del 05-10 copiados
  de producción. El balance de 2FZ863 (ACABADO) da 3.70 / 11.28 / 12, igual que
  el PDF SALIM. Se descargaron PDF y Excel de TE5247, 2FZ863 y 3LS002; el Excel
  abierto en LibreOffice recalcula bien sus fórmulas.

## Vuelta atrás

`sql/parche_96_rollback.sql` borra las cuatro funciones.
