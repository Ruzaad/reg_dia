# PARCHE 104 — Estudios de tiempos: base madre y toma de tiempos

> **Sin aplicar.** Lo corre Ruzaad en el SQL Editor (`sql/parche_104.sql`).
> Vuelta atrás: `sql/parche_104_rollback.sql`.

## Para qué

Los analistas toman tiempos con el aplicativo de estudios de tiempos
(repo `estudios-tiempos`) y eso alimenta la BASE. Hoy ese aplicativo guarda en
un Google Sheet aparte, con sus propios catálogos y sin usuario.

## Qué cambia para el usuario

**En el celular (aplicativo de tiempos).** Se entra con el usuario y PIN de
Samitex. Solo quien tenga la pestaña **Tomar tiempos** y **edición** en el área.
El artículo, la operación y el operario salen de Samitex, no se escriben a mano.
Lo medido sube a Samitex, y sin señal se guarda en el celular hasta que vuelva.

**En Ingeniería.** Grupo nuevo **Tiempos**:

- **Tiempos medidos**: por área y artículo, cada operación de la BASE con su
  STD, el tiempo medido, la diferencia, la confianza, cuántos operarios y los
  minutos producidos en 30 días. Botón **Aplicar** cuando difieren 5 % o más.
  El histórico de la operación muestra cada medición y los cambios de STD.
- **Qué falta medir**: lo más producido sin estudio consolidado.
- **Historial de tiempos** (el del parche 86) suma la columna **Origen**:
  MANUAL, EXCEL o ESTUDIO con quién midió.

Aplicar cambia el STD solo del artículo que se está viendo, salvo que se marque
"todos los artículos del área".

## Qué cambia en la base

- **`tiempos_operaciones`** es la base madre: una operación por área, aunque se
  repita en muchos artículos. Se siembra con las operaciones que ya están en
  `bases` (une las que solo cambian por tildes, espacios o mayúsculas) y un
  trigger agrega las que traiga un artículo nuevo. La postura vive aquí
  (18 % de pie, 13 % sentado) y arranca en `sentado`.
- **`tiempos_estudios`**, **`tiempos_ciclos`**, **`tiempos_inconvenientes`**:
  cada medición como la tomó el analista. El `id` lo genera el dispositivo, así
  que reenviar un lote no duplica.
- **`tiempos_estandar`** (vista): el TN más bajo entre los operarios que
  compiten, por método. 1 operario `provisional`, 2 `en_validacion`,
  3 o más `consolidado`. El conteo no compite con el cronómetro y lo tomado en
  simultáneo nace sin competir.
- **`bases_log`** suma `origen` y `estudio_id`. El trigger del parche 86 los
  llena desde `app.origen`/`app.estudio`; un cambio normal sigue siendo MANUAL.
- RPC nuevas: `fn_tiempos_catalogo`, `fn_tiempos_subir`, `fn_tiempos_mios`
  (aplicativo), `fn_tiempos_medidos`, `fn_tiempos_detalle`, `fn_tiempos_falta`,
  `fn_tiempos_aplicar`, `fn_tiempos_postura` (Ingeniería).
- Pestañas nuevas en Permisos: `pasoTmpMed`, `pasoTmpFalta`, `pasoTmpTomar`.
  Los analistas de INGENIERIA arrancan con las dos de lectura; **Tomar tiempos**
  lo reparte el maestro.

No toca tickets, reclamos, eficiencias ni ninguna función existente aparte del
trigger de `bases_log` y de `fn_bases_log`, que solo suman columnas.

## Cómo se comprobó

Postgres 16 local con `operarios`, `bases`, `bases_log`, `permisos_*` y
`reclamos` como en producción:

- La base madre une `MARCAR+PEGAR  BOLSILLO` y `Marcar+pegar bolsíllo` en una
  sola operación, y un artículo nuevo agrega la suya sola.
- KROJAS (solo lectura en CAMISA) no puede tomar tiempos ni aplicar
  (`NO_AUTORIZADA_AREA: solo lectura en CAMISA COSTURA`), pero sí ver.
- Reenviar el mismo estudio no duplica; una operación de otra área se rechaza.
- Con dos operarios el estándar queda `en_validacion` con el TN más bajo.
- Aplicar dejó `LFABIAN EDITADO ESTUDIO 1.10 → 0.89` en `bases_log`; un cambio
  a mano en Bases siguió siendo MANUAL. Aplicar de nuevo no cambia nada.
- Una operación sin estudio responde `SIN_ESTUDIO` y no toca la BASE.
- El rollback deja `fn_bases_log` y el trigger como los dejó el parche 86, y el
  parche se puede volver a correr encima.
