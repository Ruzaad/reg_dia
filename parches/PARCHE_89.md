# PARCHE 89 — Ingeniería · SUBIDA DE HOJAS DE NUMERACIÓN (HN)

> **Pendiente de aplicar.** Va en el despliegue conjunto con los parches 88, 90 y 91.

## Para qué

Mientras las HN se sigan subiendo a mano, que subirlas sea más rápido y que un
error no quede para siempre.

## Qué se ve (ingenieria.html → OFs registradas → Dar de alta una OF)

- Zona para **arrastrar las HN** (una o varias) o tocar y elegirlas. También se
  pueden soltar en cualquier parte de la pantalla; la sección se abre sola.
- Cada hoja se **compara con lo ya registrado antes de escribir** y lleva una
  etiqueta:
  - **Nueva**: se registra.
  - **Se agrega esta prenda**: la OF ya tiene la otra prenda del terno.
  - **Ya registrada igual**: se omite sola, no hace falta quitarla.
  - **Ya registrada con diferencias**: lista qué cambia (artículo, prenda,
    unidades, paquetes y el primer paquete distinto). Se puede marcar
    **Reemplazar lo registrado con esta HN**; si no se marca, se omite.
- Avisos nuevos: filas con cantidad 0 (se tachan y no se guardan), filas de
  TOTAL ignoradas, libro sin hoja "HN" (se lee la primera con TALLA / CANT),
  dos hojas con la misma OF y prenda, y el mismo archivo cargado dos veces.
- Las filas leídas quedan plegadas en "Ver las N filas leídas" para que las
  tarjetas ocupen menos.

## Qué cambia en la base

Solo agrega `fn_of_reemplazar(dni, token, of, articulo, prenda, cant_prog, detalle)`
(solo INGENIERIA). Reescribe el desglose de una OF ya registrada:

- Se niega si la OF tiene **tickets reclamados (ACTIVO)** en cualquier área,
  porque el código de ticket sale del N° de paquete.
- OF de una prenda: reemplaza artículo, prenda, corte y paquetes.
- OF de dos prendas (terno): reemplaza solo los paquetes de esa prenda; el
  corte no se toca.
- Refresca el caché de tickets de las áreas donde ya se generó.

`fn_of_registrar` no cambia, así que los despliegues sin migrar siguen igual.

Para deshacer:
`drop function public.fn_of_reemplazar(text, uuid, text, text, text, numeric, jsonb);`

## Cómo se probó

- La función, en una transacción que se revierte sola: OF 10420 (generada en
  CAMISA COSTURA, sin reclamos) pasó de 11 a 2 paquetes, corte 47, la fila de
  cantidad 0 no se guardó, y los tickets del caché pasaron de 632 a 114 en
  103 ms. Después se verificó que 10420 seguía con sus 11 paquetes. Con OF con
  reclamos (9838, 9895), OF inexistente y detalle vacío devuelve el error.
- La pantalla, con las RPC simuladas y cuatro HN armadas: una igual (se omite),
  una con diferencias en "Hoja1" y fila TOTAL (reemplazo), la segunda prenda
  de un terno y una nueva con una fila en 0. Se escribieron exactamente las 3
  que tocaba. Sin desborde a 1366 y 390 px.
