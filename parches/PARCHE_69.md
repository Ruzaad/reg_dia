# PARCHE 69 — Bases: edición en lote, ancho de Ingeniería y filtro de PRENDA

## 1. Edición en lote

Corregir el mismo STD en varios artículos —filtrar por una operación y tocar las 15
filas que salen— obligaba a abrir el modal 15 veces. Ahora hay un botón
**✎ EDITAR EN LOTE** que convierte en editable todo lo que está en pantalla.

Cómo se comporta:

- Se editan **Prenda, Cliente, Módulo, Artículo, Operación, STD y N_OP**.
  **MAX OP. no**: lo recalcula `_base_resecuenciar` en la BD a partir del número de
  operaciones del artículo, igual que en la edición de una fila.
- **Escribir en una celda no repinta la tabla ni toca la BD.** Los cambios viven en
  `BASE_DIRTY` (un mapa por id) hasta pulsar GUARDAR. La celda tocada y su fila se
  marcan en ámbar, y un contador dice cuántos cambios hay pendientes.
- Como el mapa va por **id**, los cambios sobreviven a ordenar, filtrar y cambiar de
  página. Se puede filtrar por operación, tocar esas filas, filtrar por otra y seguir:
  todo se guarda junto.
- Devolver una celda a su valor original quita la marca y baja el contador; `↺`
  deshace la fila entera; CANCELAR descarta todo, pidiendo confirmación si hay algo
  pendiente.
- Lo que ya existía sigue igual: el modal de una fila, Borrar, + Agregar operación,
  Borrar artículo y Subir Excel. Durante la edición en lote, Borrar se oculta por
  fila para no mezclar una acción destructiva con cambios sin guardar.

### Base de datos

Función nueva **`fn_base_ops_editar_lote(p_dni, p_token, p_cambios jsonb)`**.

Aplica todos los cambios en **una transacción**, con **una sola resecuencia y una
sola sincronización por artículo** al final: por fila, 15 cambios del mismo artículo
lo renumerarían 15 veces y propagarían a `reclamos` otras tantas.

**Atomicidad**: las validaciones se levantan con `raise`, no con `return`. El bloque
`EXCEPTION` de plpgsql es una subtransacción, así que salir por ahí deshace las filas
ya actualizadas; con un `return` a media pasada el lote quedaría escrito a medias.

`fn_base_op_editar` (una fila, desde el modal) **no se toca** y se sigue usando.

### Lo que sigue siendo por artículo

La sincronización del ALMACÉN (el Sheet) va por artículo, porque la edge function
recibe uno solo. Un lote de 15 artículos son 15 llamadas seguidas, así que el
guardado muestra `Sincronizando ALMACÉN 3/15…` mientras avanza. Las áreas sin Sheet
—ACABADO, por ejemplo— no pagan ese coste: `sincronizarAlmacen` corta antes.

## 2. Ancho de Ingeniería

`.contenedor-ancho` topaba en 1100 px, así que en una pantalla de 1920 quedaban unos
590 px muertos a los lados. Y la barra de filtros **no** tenía tope, por lo que salía
más ancha que la tabla de abajo: eso era el desborde que se veía.

Ahora las tres cosas —`.contenedor-ancho`, `.fila-filtros` y `.barra-control`—
comparten un solo ancho (`--ancho-ing: 1600px`) dentro de
`body[data-pagina="ingenieria"]`. Se aprovecha la pantalla y todo queda alineado.

El texto corrido **no** entra en el cambio: `.seccion-sub` conserva su tope de 70ch,
que es lo legible. El alcance es solo Ingeniería (escritorio): `.contenedor-ancho`
no se usa fuera de `ingenieria.html`, y la única `.fila-filtros` de supervisora
—que es móvil— queda intacta.

Efecto lateral bueno: en Bases los filtros pasan de tres líneas a dos.

## 3. Filtro de PRENDA

`#fPrenda`, junto al resto de filtros de Bases, con el mismo criterio que los demás
(`normKey` + `includes`). Va primero porque PRENDA es la primera columna de la tabla.

## Cómo se comprobó

- `fn_base_ops_editar_lote` contra producción, con un lote de 3 filas de 3 artículos
  distintos escribiendo sus valores actuales: `ok:true`, 3 filas, 260 reclamos
  sincronizados, y las filas quedaron idénticas (`std`, `max_op`, `n_op`).
- Atomicidad, también contra producción: un lote que cambiaba el STD de la primera
  fila a 9.99 y dejaba la segunda sin operación devolvió `ok:false` y la primera
  **siguió en 0.67**.
- El flujo completo en Chromium, con la tabla real de ACABADO / PLANCHADO:
  el filtro de prenda distingue "camisa" (0 filas) de "pantalon" (15);
  al entrar en edición salen 105 inputs y GUARDAR está deshabilitado;
  al escribir en dos celdas **el `<tbody>` sigue siendo el mismo nodo** —no se
  repintó—, el contador marca 2 cambios y las dos filas quedan en ámbar;
  devolver una celda a su valor original baja el contador a 1;
  al filtrar por otro cliente el cambio pendiente sigue ahí;
  y el payload enviado lleva la fila completa con el STD nuevo.
- Sin desbordes horizontales ni errores de JS en Bases y Resumen de OF a 1920, 1440,
  1100, 820 y 400 px.
