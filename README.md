[DOCUMENTACION.md](https://github.com/user-attachments/files/30354995/DOCUMENTACION.md)
# SAMITEX — Tickets Virtuales · Documentación del sistema

> Manual funcional y técnico del piloto de registro de producción por tickets.
> Última actualización: **2026-07-24** (incorpora Parches 3–10 — ver `parches/PARCHE_3.md` … `parches/PARCHE_10.md`). El **Parche 10** aplica la Solicitud de Cambios de 11 puntos: la supervisora solicita minutos (aprueba solo ingeniería), estados FALTA/DM/LICENCIA/INACTIVO fuera de cálculos, filtros por módulo en cascada (Área→Artículo→OF→fecha), sidebar colapsable/responsive con deep-links, eficiencia por día ordenable + PROM al final, asistencia (sin "Cambiar Área", resumen mensual por persona-días), restricción de área de supervisora endurecida en backend, división de las 2 últimas operaciones en paquetes de N, liberar tickets en "Por personal", y fix del buscador con "/". El rediseño de Ingeniería (Parches 6–7) está completo: Fase 1 (diseño+IA, frontend) + Fases 2–5 (Por módulo %avance, Operar como operario, Eficiencias del personal en supervisora, correcciones de datos), con backend en `sql/parche_7.sql`. Errores globales ahora son toasts abajo-derecha.
> Documentos relacionados: [`sql/esquema-supabase.md`](sql/esquema-supabase.md) (esquema BD) · [`sql/README_DESPLIEGUE.md`](sql/README_DESPLIEGUE.md) (despliegue original).

---

## Índice
1. [Qué es y cómo funciona](#1-qué-es-y-cómo-funciona)
2. [Arquitectura](#2-arquitectura)
3. [Roles y accesos](#3-roles-y-accesos)
4. [Áreas y almacenes (Google Sheets)](#4-áreas-y-almacenes-google-sheets)
5. [Vista Operario](#5-vista-operario)
6. [Vista Supervisora](#6-vista-supervisora)
7. [Vista Ingeniería](#7-vista-ingeniería)
8. [Cálculo de eficiencia y minutos](#8-cálculo-de-eficiencia-y-minutos)
9. [Catálogo de funciones RPC](#9-catálogo-de-funciones-rpc)
10. [Modelo de datos](#10-modelo-de-datos)
11. [Seguridad](#11-seguridad)
12. [Despliegue y configuración](#12-despliegue-y-configuración)
13. [Operación diaria y solución de problemas](#13-operación-diaria-y-solución-de-problemas)
14. [Glosario](#14-glosario)

---

## 1. Qué es y cómo funciona

Aplicación web (PWA) para que el personal de costura registre su producción reclamando
**tickets** (paquetes de prendas) desde el celular, y para que supervisión e ingeniería
controlen eficiencia, asistencia, incidencias y bases de tiempos.

Flujo resumido:
1. **Ingeniería** carga la **BASE** de tiempos (STD por operación de cada artículo) y publica el **almacén** del día en Google Sheets.
2. El **operario** entra con DNI + PIN, elige OF → módulo → operación → paquete, y lo **reclama** (queda a su nombre y suma minutos producidos).
3. La **supervisora** ve el avance de su área, registra ocurrencias (máquina parada, tardanza, hora extra…), mueve personal entre áreas y marca faltantes.
4. **Ingeniería** consolida todo: eficiencias por persona/área, tickets del día, asistencia mensual, incidencias y CRUD de bases.

La eficiencia = **minutos producidos / minutos disponibles**. Un ticket "vale" `STD × cantidad` minutos.

---

## 2. Arquitectura

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | HTML + CSS + JS puro (sin framework) | Estático, servible desde GitHub Pages. PWA con `sw.js` + `manifest.json`. |
| Backend | **Supabase** (PostgreSQL) | Todo el acceso vía funciones **RPC `SECURITY DEFINER`**; no hay acceso directo a tablas para el cliente. |
| Almacén de tickets | **Google Sheets** (CSV público) | Cada área lee su hoja `ALMACEN` vía `gviz/tq?...out:csv`. |
| Autenticación | DNI/usuario + PIN → **token UUID** (4 h) | Guardado en `localStorage` (`stx_sesion`). |

**Archivos del frontend:**

| Archivo | Rol |
|---|---|
| `index.html` | Login + selección de área. |
| `operario.html` | Reclamo de tickets (operario / estajero). |
| `supervisora.html` | Panel de supervisión de área. |
| `ingenieria.html` | Panel de ingeniería (PC). |
| `app.js` | Lógica compartida: sesión, RPC, login, operario, supervisora, helpers. |
| `ingenieria.js` | Lógica exclusiva de ingeniería (requiere `app.js` cargado antes). |
| `style.css` | Estilos de todas las vistas. |
| `sw.js`, `manifest.json`, `icon-*.png` | PWA. |

**Configuración clave** (arriba de `app.js`): `SUPABASE_URL`, `SUPABASE_ANON`, `AREAS`, `SESION_HORAS`, `MAPA_ESTANDAR`.

---

## 3. Roles y accesos

El `cargo` vive en `operarios.cargo` y determina a qué vista redirige el login:

| Cargo | Vista | Puede |
|---|---|---|
| `OPERARIO` | `operario.html` | Reclamar tickets de su área; solicitar ajuste de tiempo; cambiar su PIN. |
| `ESTAJERO` | `operario.html` | Igual que operario pero **elige área** en cada sesión (no fija `area_actual`). |
| `SUPERVISORA` | `supervisora.html` | Ver avance del área; ocurrencias; mover personal de área; **marcar faltantes**; resolver incidencias de su área; cambiar su PIN. |
| `INGENIERIA` | `ingenieria.html` | Todo lo transversal: eficiencias, tickets del día, bases (CRUD), asistencia, incidencias, liberar tickets, cambiar su PIN. |

**Login de ingeniería:** en la pantalla de login, enlace *"Ingreso ingeniería"* → usa **usuario de texto** (no DNI de 8 dígitos) + PIN.

**Cambio de PIN (todos los roles):** ícono **🔑** en el encabezado → pide PIN actual + nuevo (2 veces, 4 dígitos). Backend: `fn_cambiar_pin`.

---

## 4. Áreas y almacenes (Google Sheets)

Definidas en `AREAS` (`app.js`). Solo las `habilitada:true` aparecen para reclamar y cargan almacén.

| Área | Estado | sheetId |
|---|---|---|
| `CAMISA COSTURA` | Habilitada | `1fuqMApXsZg-0PW4ugqtnye6zysVtoSAS_o4hhN1WDlo` |
| `PANTALON COSTURA` | Habilitada | `1Or0seuSsiqmHSPAQ39RAfh1nWhpUtGi_ugFu4C4XCns` |
| `ACABADO` | Deshabilitada (falta compartir/confirmar columnas) | `1R2FqLRZpFjdA7rzUk6dsTyj898yUYO0aKU_OYG4e0Xc` |
| `SACO COSTURA` | Deshabilitada | — |

> Además existen áreas "solo de datos" en la BD (CORTE, REPROCESOS, etc.) que aparecen en
> selects vía `fn_areas_listar`, pero no tienen almacén en Sheets.

**Requisitos del libro de almacén:**
- Compartido como **"Cualquier persona con el enlace: Lector"**.
- Pestaña llamada exactamente **`ALMACEN`** (o ajustar `hoja` en `AREAS`).
- `CÓDIGO` único e inmutable; `NUMERACIÓN` como texto.

**Cabeceras esperadas** (normalizadas por `normKey`, que ignora tildes, espacios y símbolos):

| Cabecera en Sheets | Campo interno |
|---|---|
| PRENDA | prenda |
| ARTÍCULO | articulo |
| MÓDULO | modulo |
| OP | op |
| STD | std |
| O.F | of |
| TALLA | talla |
| COLOR | color |
| N° CORTE | corte |
| CANT. | cant |
| CÓDIGO | codigo |
| N°OP | nop |
| NUMERACIÓN | num |
| GRUPO | *(sin mapear — no se usa en el flujo)* |

Un ticket vale `minutos = STD × CANT` (redondeado a 1 decimal).

---

## 5. Vista Operario

**Encabezado:** título de área · badge de avance (`Hoy: X% · prod de disp min`) · **👁** censurar eficiencia · **↻** recargar eficiencia · **🕐** solicitar ajuste de tiempo · **🔑** cambiar PIN · badge con **apellidos** (texto antes de la coma del registro).

**Flujo:** `OF → Módulo → Operación → Ticket → Confirmación`.
- **Breadcrumb** dinámico en el encabezado (OF › Módulo › Operación); al retroceder se limpia la selección profunda para no dejar pasos viejos.
- Buscador de OF por número, con conteo de "libres de total".
- Cada ticket muestra numeración, color, talla, cantidad, corte, N°OP y minutos.
- **Marcar varios**: selección múltiple → reclamo en lote (`fn_reclamar_lote`, máx. 60).
- Ticket ya tomado: se muestra **"Tomado por {APELLIDOS} · hora"** — solo los **apellidos** (texto antes de la coma del registro).
- **Pantalla de éxito**: se muestra **2.5 s** y regresa a la lista.
- **Solicitar ajuste de tiempo** (🕐): envía a supervisión/ingeniería una solicitud (+/− minutos con motivo) → `fn_solicitud_ajuste_crear`.
- **ESTAJERO**: primero elige el área de trabajo del reclamo; puede cambiarla con "CAMBIAR ÁREA".

---

## 6. Vista Supervisora

Pensada para personal de 30-40 años: filtros más visibles, disclaimer pequeño y no fijo.

**Encabezado:** área · badge · **↻** recargar (recarga la pestaña activa) · **🔑** cambiar PIN · Salir.

**Pestañas:**
- **PERSONAL**: lista de su personal (nombre, DNI, minutos disponibles). Botones POST **flotantes a la derecha**:
  - **OCURRENCIA GRUPAL** → tipo OTROS a todos o a algunos.
  - **CAMBIAR ÁREA** → mueve personal a otra área (registra hora; el servidor prorratea minutos entre áreas).
  - **MARCAR FALTANTES** → registra estado de asistencia (FALTA/DM/etc.) del personal que no está en su área hoy. **No suma minutos** a su área (un estado ausente deja disponible = 0). Backend: `fn_marcar_asistencia` (solo su área).
- Tocar una persona → registrar ocurrencia individual: **MÁQUINA PARADA, HORA EXTRA, TARDANZA, SEGURO, PERMISO, OTROS**. TARDANZA/SEGURO/PERMISO exigen motivo (hora de salida/regreso).
- **AVANCE DEL DÍA**: KPIs del área (eficiencia, presentes, min producidos/disponibles) + notificaciones de la última operación. Auto-refresco cada 60 s.
- **INCIDENCIAS**: solicitudes de ajuste de tiempo del personal → aprobar (con minutos) o rechazar.

---

## 7. Vista Ingeniería

**Pensada solo para PC (laptop 1920×1080).** Usa un **sidebar** de navegación a la izquierda (no tabs) y el contenido con scroll propio a la derecha; header + sidebar quedan fijos. Tipografías Fira Sans/Fira Code, accesible con teclado y mouse (foco visible), sin FABs (filtros de área por select). Encabezado con **↻** recargar (sección activa) y **🔑** cambiar PIN. Navegación del sidebar (Parche 6): **Tickets** (Actual · Por módulo) · **Eficiencia** (Por área · Por día) · **Gestión** (Bases · Asistencia · Incidencias) · **Operar como** (Supervisora · Operario). Varias sub-secciones tienen *gating*: no muestran datos hasta elegir área.

### 7.1 EFICIENCIAS
- KPIs por área + tabla por persona **agrupada por área** (áreas bien separadas, encabezado por grupo), ordenable por columna.
- **FAB de áreas flotante** para filtrar la tabla por área (además del select).
- **👁 CENSURAR**: reemplaza todos los % por `****` (tabla, KPIs y rango). Toggle.
- **Eficiencia día × día por rango**: matriz persona × día, con promedio. Botón de descarga reubicado a la derecha (fila propia). Descarga XLSX con **% enteros** (88, 34 — no 87.1/33.3). Días sin trabajo (o fin de semana sin producción) salen como "—".

### 7.2 TICKETS DEL DÍA
- Tabla de todos los reclamos del día (hora, nombre, área, OF, artículo, operación, N°OP, num, cant, min, código, estado). Ingeniería **sí ve el nombre** de quien tomó cada ticket.
- **Tarjetas de última / penúltima operación**: suman cantidades de los tickets ACTIVOS cuya N°OP coincide con el mayor / 2º mayor N°OP del artículo (según BASE).
- **FAB de áreas** (flotante a la derecha): solo las áreas que registraron tickets hoy. Al elegir una, filtra tabla y tarjetas a esa área ("TODAS" para quitar el filtro).
- **Liberar tickets**: botón LIBERAR por fila (cualquier ingeniería) + **LIBERAR EN LOTE** (checkboxes → `fn_liberar_lote`). El servidor revalida el permiso.
- DESCARGAR XLSX de los tickets visibles.

### 7.2b POR MÓDULO
- Agrupa los tickets **ACTIVOS** del día por **área · módulo**, y dentro por **persona** (apellidos), listando sus tickets reclamados (numeración) con total de tickets y minutos.
- Filtros: fecha, búsqueda de texto y **FAB de áreas**.
- Sirve para ver de un vistazo quién está trabajando en cada módulo y en qué.

### 7.3 BASES
- Tabla de operaciones por artículo (prenda, cliente, módulo, artículo, operación, STD, Max Op., N°OP).
- **★ dorada** = operación **final** (mayor N°OP del artículo); **★ plateada** = **penúltima** (2º mayor). De aquí sale el reporte de última/penúltima en Tickets del día.
- **CRUD por fila**: `+ AGREGAR OPERACIÓN`, **Editar** y **Borrar** (STD, artículo, operación, N°OP, etc.). Backend: `fn_base_op_crear/editar/eliminar`.
- **SUBIR EXCEL**: importa un archivo, muestra un **diff** (qué se agrega/quita/cambia por artículo) y al confirmar reemplaza solo esos artículos. El archivo **no se guarda**: solo se extraen sus datos (texto/números) y permanecen en la BD.
- DESCARGAR XLSX de la base filtrada.
- **Rendimiento**: la tabla renderiza hasta **400 filas** por vez (la base puede tener miles); si hay más, avisa y pide filtrar por artículo/operación/cliente.

### 7.4 ASISTENCIA
Dos sub-vistas (selector arriba):
- **Matriz mensual**: persona × día del mes. Clic en una celda edita **solo ese día** (`fn_asignar_estado_rango` con desde=hasta). Ejemplo: marcar FALTA y luego corregir a ACTIVO cambia únicamente ese registro. Selección múltiple → CAMBIAR ÁREA o ASIGNAR ESTADO POR RANGO. `+ AGREGAR PERSONAL` / editar persona (modal): datos, cargo, estado y **RESETEAR PIN**.
- **Detallado día × estado**: se elige un día del mes cargado y se listan las personas agrupadas por estado (ACTIVO, FALTA, DM, VACACIONES, LICENCIA…). Sin registro ese día = ACTIVO.
- Los chips de resumen de estados quedan separados de la fila de botones (espaciado corregido).

### 7.5 INCIDENCIAS
- Todas las solicitudes de ajuste pendientes (de todas las áreas) → aprobar/rechazar.

### 7.6 OPERAR COMO SUPERVISORA
- Ingeniería elige un **área** y opera con **las mismas pantallas y lógica de la supervisora** (personal, ocurrencias, avance del día, incidencias, cambiar área, marcar faltantes) — sin duplicar código: se reutilizan las funciones de supervisión con un override de área.
- Sub-tabs propios (PERSONAL / AVANCE / INCIDENCIAS) + botón "◀ Áreas" para cambiar de área.

---

## 8. Cálculo de eficiencia y minutos

- **Jornada:** turno 08:00–18:20 (620 min de reloj), **575 min efectivos** (descontados 45 min de comida).
- **Minutos disponibles** = 575 ± ocurrencias del día (máquina parada resta, hora extra suma, etc.), prorrateado si hubo movimientos de área (`_disp_prorrateado`).
- **Fin de semana (sáb/dom, hora Lima):** **no laborable** → disponible = **0** salvo que la persona tenga reclamos ACTIVOS ese día; si produjo, se calcula la jornada normal.
- **Ausencias** (FALTA/DM/VACACIONES vía `_ausente`): disponible = 0 ese día (no penaliza eficiencia del área).
- **Producido** = suma de `minutos` de reclamos ACTIVOS del día en el área correspondiente.
- **Eficiencia** = `producido / disponible × 100` (0 si disponible = 0).

---

## 9. Catálogo de funciones RPC

> Firmas completas y código fuente en [`sql/esquema-supabase.md`](sql/esquema-supabase.md).
> Helpers internos: `_auth`, `_ing`, `_hoy`, `_ausente`, `_estado_dia`, `_disp_prorrateado`, `fn_validar_ingenieria`.

| Función | Usada por | Propósito |
|---|---|---|
| `fn_login` | index | DNI/usuario + PIN → token 4 h. |
| `fn_cambiar_pin` ★ | todas | Cambiar PIN propio (valida PIN actual). |
| `fn_areas_listar` | varias | Distinct de áreas en `operarios`. |
| `fn_reclamados` ✎ | operario | Códigos tomados por área (con nombre; el front muestra solo apellidos — Parche 5). |
| `fn_reclamar` / `fn_reclamar_lote` | operario | Reclamar ticket(s). |
| `fn_mi_dia` | operario | Prod/disp/eficiencia del día propio. |
| `fn_solicitud_ajuste_crear` | operario | Crea solicitud de +/− minutos. |
| `fn_personal` ✎ | supervisora / ingeniería | Personal del área con disponibles (ingeniería puede pasar cualquier área — Parche 4). |
| `fn_avance_area` | supervisora | KPIs + notificaciones del área. |
| `fn_ocurrencia` | supervisora/ing | Registrar ocurrencia (máquina, tardanza…). |
| `fn_cambiar_area` | supervisora/ing | Mover personal de área (con hora). |
| `fn_marcar_asistencia` ✎ | supervisora/ing | Marcar estado (UPSERT; supervisora solo su área). |
| `fn_solicitudes_listar` / `fn_solicitud_resolver` | supervisora/ing | Ver/aprobar/rechazar ajustes. |
| `fn_eficiencia_dia` / `fn_eficiencia_rango` | ingeniería | Eficiencias por persona/área. |
| `fn_tickets_dia` ✎ | ingeniería | Reclamos del día (con nombre y `modulo` — Parche 4). |
| `fn_liberar_ticket` ✎ | ingeniería | Liberar un ticket (**cualquier ingeniería**). |
| `fn_liberar_lote` ★ | ingeniería | Liberar varios tickets por código. |
| `fn_bases_listar` ✎ / `fn_bases_existentes` | ingeniería | Listar base (ahora con `id`) / diff. |
| `fn_bases_subir` | ingeniería | Reemplazo masivo por artículos (desde Excel). |
| `fn_base_op_crear` / `_editar` / `_eliminar` ★ | ingeniería | CRUD de base por fila. |
| `fn_asistencia_mes` / `fn_asistencia_dia` | ingeniería | Asistencia mensual/diaria. |
| `fn_asignar_estado_rango` | ingeniería | Estado por rango (o 1 día). |
| `fn_estados_asistencia_listar` | sup/ing | Estados disponibles. |
| `fn_personal_crear` / `_editar` / `_detalle` / `_resetear_pin` | ingeniería | Gestión de personal. |

★ = nueva en Parche 3 · ✎ = modificada en Parche 3 o 4.

---

## 10. Modelo de datos

Tablas principales (detalle completo en el esquema):

- **`operarios`** — dni, nombres_apellidos, area_origen, area_actual, estado, cargo, pin, token, token_expira.
- **`reclamos`** — ticket reclamado: codigo, dni, area, o_f, modulo, op, std, cant, minutos, numeracion, articulo, color, talla, corte, nop, estado (ACTIVO/LIBERADO), motivo_liberacion, fecha.
- **`bases`** — id, area, prenda, cliente, modulo, articulo, operacion, std, max_op, n_op, subido_por.
- **`asistencia`** — dni, fecha, estado, registrado_por (único por dni+fecha).
- **`estados_asistencia`** — catálogo de estados (FALTA, DM, VACACIONES, ACTIVO, …).
- **`ocurrencias`** — dni, area, tipo, minutos, detalle, supervisora_dni, fecha.
- **`movimientos_area`** — dni, area_anterior, area_nueva, movido_por, fecha (para prorrateo).
- **`solicitudes_ajuste`** — solicitudes de +/− minutos del operario (PENDIENTE/APROBADO/RECHAZADO).
- **Vista `base_diaria`** — consolidado diario (tickets, min prod/disp, eficiencia) por operario.

---

## 11. Seguridad

- **Toda** la autorización vive dentro de las RPC (`p_dni` + `p_token`), validada por `_auth`/`_ing`/`fn_validar_ingenieria`. El cliente nunca toca tablas directamente.
- Sesión = token UUID con expiración 4 h; al vencer, la app hace logout automático.
- **PIN en texto plano** (`operarios.pin`): sin hash. Riesgo conocido del piloto.
- **`solicitudes_ajuste`** tiene grants directos a `anon`/`authenticated` (incluye TRUNCATE) — hallazgo pendiente de revisar (ver esquema, sección Riesgos).
- RLS activo pero **no forzado** en las tablas.

---

## 12. Despliegue y configuración

**Base de datos (una vez / por parche):**
1. `sql/supabase_setup.sql` (inicial).
2. `sql/parche_2.sql` (segundo lote).
3. `sql/parche_3.sql` (ver `parches/PARCHE_3.md`).
4. `sql/parche_4.sql` (ver `parches/PARCHE_4.md`).
5. `sql/parche_5.sql` (ver `parches/PARCHE_5.md`).
6. **`sql/parche_7.sql`** (Fases 2–5 de Ingeniería — ver `parches/PARCHE_7.md`). *(No hay parche_6.sql: la Fase 1 fue solo frontend.)*

**Configurar `app.js`:** `SUPABASE_URL`, `SUPABASE_ANON` (Settings → API), y `sheetId`/`hoja` de cada área en `AREAS`.

**Frontend:** subir todos los archivos a la raíz del repo de GitHub Pages. La URL resultante es la que se comparte. Instalar en el celular con "Agregar a pantalla de inicio".

---

## 13. Operación diaria y solución de problemas

| Situación | Acción |
|---|---|
| Ticket mal reclamado | Ingeniería → Tickets del día → **LIBERAR** (o LIBERAR EN LOTE). |
| Operario olvidó/necesita PIN nuevo | Él mismo con 🔑, o ingeniería con **RESETEAR PIN** (queda `1234`, ingeniería `1111`). |
| Persona en área equivocada | Supervisora → **CAMBIAR ÁREA**; o ingeniería en Asistencia. |
| Falta/permiso | Supervisora → **MARCAR FALTANTES**; o ingeniería en Asistencia (clic en celda). |
| "SIN BASE cargada" en avance | Ingeniería → BASES → subir/crear la base de ese artículo. |
| Almacén no carga | Verificar que el libro esté compartido como Lector y la hoja se llame `ALMACEN`. |
| Sesión expira sola | Es normal a las 4 h; volver a iniciar sesión. |
| Proyecto Supabase pausado (~7 días sin uso) | Reactivar a mano en el panel de Supabase. |

---

## 14. Glosario

- **OF**: Orden de Fabricación.
- **STD**: tiempo estándar (min) de una operación por unidad.
- **N°OP**: número de orden de la operación dentro del artículo (el mayor = operación final).
- **Ticket / paquete**: unidad reclamable identificada por `CÓDIGO` único.
- **Reclamar**: tomar un ticket a tu nombre (suma minutos producidos).
- **Liberar**: anular un reclamo (queda `LIBERADO`).
- **Prorrateo**: reparto de minutos disponibles cuando alguien cambió de área durante el día.
