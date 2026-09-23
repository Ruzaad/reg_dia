# PARCHE 83 — La división última / penúltima vuelve a verse en `ofs`

> **Aplicado en producción el 23-set-2026**, con autorización de Ruzaad. Después de aplicarlo, `_paq_div_n` da el mismo hash en los 12 780 pares (área, OF, operación), 97 OF quedan con la división llena, y ni `anon` puede leer la vista ni ejecutar `_ofs_div_sync`.

## Qué pasaba

En la tabla `ofs`, `div_ultima_n` y `div_penultima_n` estaban en NULL en las
156 OF, aunque en la app las OF sí salen troceadas.

No es que el troceo se perdiera. Desde el parche 29 se guarda en **`of_troceo`**
(una fila por OF, área y operación) cuando Ingeniería genera la OF. Las dos
columnas de `ofs` solo las llenaba el camino viejo (subir la HN al ALMACÉN del
Sheet), que ya no se usa. Las OF nuevas se registran con esas dos columnas en
NULL y nadie las volvía a tocar.

## Qué cambia

- **Se llenan solas.** Al generar o regenerar una OF, un trigger copia a `ofs`
  el troceo de la última y la penúltima operación de la ruta de esa área. Si
  una OF se generó en dos áreas (hoy solo la 9875), manda la última generada.
  ACABADO no trocea y no cuenta.
- **Backfill.** Las 97 OF ya generadas con troceo quedan con su valor. Las OF
  antiguas que nunca se generaron en el sistema no se tocan.
- **`_paq_div_n` deja de leer esas columnas en OF generadas.** Antes, si una
  operación no tenía troceo en `of_troceo`, caía a `ofs.div_*`. Como estaban en
  NULL, daba igual. Una vez llenas, habría repartido el troceo de un área a otra
  (o a otra operación). Ahora solo lo hace en OF antiguas que vienen de la HN.
- **Vista `v_ofs_troceo`.** Una fila por OF y área con el troceo completo, por
  ejemplo `N°51 en 20, N°52 en 20, … N°67 en 10`. En PANTALON y SACO casi todas
  las OF trocean muchas más operaciones que las dos últimas (la 10098 trocea
  17), y eso no entra en dos columnas. Solo se ve desde el panel de Supabase:
  no tiene permiso para `anon` ni `authenticated`.

## Cómo se probó

Todo el parche corrió en producción dentro de una transacción que se deshizo
al final:

- `_paq_div_n` devuelve **exactamente lo mismo** que antes en los 12 780 pares
  (área, OF, operación): 0 cambios. Los paquetes y tickets no se mueven.
- 97 OF quedan con al menos una de las dos columnas llena, y en las 101 parejas
  OF-área el valor de `div_ultima_n` coincide con lo que usa la app.
- Regenerar la OF 10098 (borrar e insertar su troceo) deja las columnas en
  10 / 20 y tarda 36 ms. El backfill completo tarda 113 ms.

## Ojo

Si se cambia la BASE de un artículo (operaciones que se agregan o quitan al
final), las columnas quedan con el valor del momento en que se generó la OF
hasta que se regenere. La app no lee estas columnas: siguen siendo informativas.

## Vuelta atrás

`sql/parche_83_rollback.sql` deja `_paq_div_n` como estaba y vacía las columnas.

## `areas_config` no se borra

Se revisó si se podía borrar. Sigue viva:

- `fn_areas_config_listar` la lee **13 684 veces** desde julio: cada vez que
  entra un operario o Ingeniería (`hidratarAreas` en `app.js`).
- Con ella la app sabe qué áreas están habilitadas y que ninguna lee el ALMACÉN
  del Sheet (`usa_almacen = false`). Sin la tabla, la app cae a la lista fija de
  `app.js`, donde **SACO COSTURA sale apagada** y las otras tres **vuelven a leer
  el Sheet**.
- También la leen `fn_ofs_listar` (estado por área en OFs registradas),
  `fn_origen_reclamos`, `fn_area_almacen` e Ingeniería para las hojas `OF` de
  metas y para el desplegable de Generar tickets.

### Que la app no dependa de `areas_config` para funcionar

`app.js` trae una copia local de las áreas (`AREAS`) que se usa si
`fn_areas_config_listar` falla. Esa copia estaba vieja: SACO COSTURA estaba
apagada y ninguna área traía `usaAlmacen`, así que ante un fallo de la RPC la app
volvía a leer el ALMACÉN del Sheet sin avisar.

Ahora la copia es igual a la tabla: las 4 áreas están habilitadas, todas con
`usaAlmacen: false` y cada una con su `hojaOF`. Además, si falta el dato, el
Sheet queda **apagado** por defecto (antes quedaba prendido). Un fallo de
`areas_config` ya no cambia lo que ve el operario.

Si mañana se agrega un área, hay que darle fila en `areas_config` **y** copiarla
en `AREAS` de `app.js`.
