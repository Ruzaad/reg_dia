# PARCHE 68 — Resumen de OF: todas las operaciones del balance

## Qué se pidió
En **Resumen de OF**:

- La tabla principal queda en **Artículo · OF · Corte real · Entrada · Salida · Estado**
  (se retira la columna *Módulos listos*).
- Al abrir ▾, el detalle muestra por módulo: **área, módulo, todas las operaciones
  del balance, producida, porcentaje y estado** (EN PROCESO / COMPLETADO).
- Se elimina el filtro *última / penúltima operación del módulo*. Queda solo el
  buscador y se listan **todas las OF**, terminadas y en proceso, en una sola tabla.
- El Excel pasa a tres hojas — **GENERAL**, **MODULO** y **OPERACION FINAL** — con el
  mismo criterio de columnas en las tres: `Cantidad X OF` (el corte real) antes de
  `Producida`, y `Estado` antes de `Entrada` / `Salida`.
- En el Excel la OF sale con el **código de 10 dígitos del ERP**: `4` más la OF
  rellenada con ceros (10136 → `4000010136`). En pantalla la OF se sigue leyendo
  corta.
- Los módulos se ordenan por el **N°OP de su operación final** — el orden de la
  ruta — y no por el nombre del módulo. Acabado sigue yendo al final, en su propio
  cuadro. Afecta al detalle ▾ y a las hojas MODULO y OPERACION FINAL; la hoja
  GENERAL es una fila por OF, no tiene N°OP, y va por fecha de entrada
  (la más reciente primero).
- **Filtro de periodo por meses**, para que el Excel y la carga no crezcan sin
  techo.

## La regla del periodo

Una OF aparece en el periodo si su ventana de actividad lo toca, así que sale
**tanto en el mes en que empezó como en el mes en que terminó**: una que arrancó en
agosto y cerró en setiembre se ve en los dos, siempre con sus fechas reales, sin
recortar al rango.

El periodo elige **qué OF** se devuelven; el cálculo no se toca. Producida,
porcentaje, entrada, salida y estado se siguen acumulando sobre **toda la
historia**. Esa es justo la trampa del parche 61: si el rango recortara los
reclamos, una OF a caballo entre dos meses saldría EN PROCESO porque las unidades
del mes anterior quedarían fuera.

Dejando los dos meses en blanco salen todas, que es el comportamiento anterior.

**Efecto de borde**: una OF en proceso que no tuvo ningún ticket dentro del rango no
sale. Se la ve ampliando el rango hasta el mes en que sí tuvo movimiento. Por eso el
valor por defecto es este mes y los dos anteriores, no solo el mes en curso.

## Qué cambió en la base

Se actualiza **`fn_of_trazabilidad`**, que queda como:

```
fn_of_trazabilidad(p_dni, p_token,
                   p_nivel text default 'PENULTIMA',
                   p_desde date default null,
                   p_hasta date default null)
```

`p_nivel` **se conserva a propósito**, aunque ya no se use. El mismo repo está
publicado en Netlify, Vercel y GitHub Pages contra esta misma base, y un push a
`main` no actualiza los tres a la vez: un frontend viejo que siga mandando `p_nivel`
tiene que seguir resolviendo en PostgREST. Se acepta y se ignora — la referencia del
módulo es siempre su operación final — y la respuesta conserva todos los campos que
esos frontends pintan (`nivel`, `n_mods`, `n_listos`, y por módulo `operacion`,
`nop`, `producida`, `cant_prog`, `ruta_base`, `es_acabado`). Como no manda
`p_desde`/`p_hasta`, recibe todas las OF, igual que antes.

Hubo que **borrar la versión de 3 argumentos**: `create or replace` con otra lista de
argumentos no reemplaza, sobrecarga. Con las dos conviviendo, PostgREST no sabría
cuál elegir al recibir `{p_dni, p_token, p_nivel}` y respondería *300 Multiple
Choices*. Con una sola función de 5 argumentos y defaults, resuelven las dos
llamadas.

Único efecto cosmético mientras quede un despliegue sin actualizar: el estado del
módulo llega como `COMPLETADO` en vez de `TERMINADO`, y su pastilla se pinta ámbar en
vez de verde. Se corrige solo cuando ese despliegue tome esta versión.

`fn_of_trazabilidad_v2` fue un paso intermedio de este mismo parche, nunca llegó a
producción y se borró.

Diferencias de cálculo frente a la versión anterior:

| | antes | ahora |
|---|---|---|
| Operaciones por módulo | una (la última o la penúltima, según `p_nivel`) | **todas las del balance** |
| Referencia del módulo | dependía de `p_nivel` | siempre la **operación final** |
| Porcentaje | no existía | `producida / corte real`, por operación y por módulo |
| Estado de módulo/operación | `TERMINADO` / `EN PROCESO` | `COMPLETADO` / `EN PROCESO` |
| Código de OF | no existía | `of_cod` = `4` + OF rellenada a 10 dígitos |

Lo que **no** cambió: entrada = primer ticket del módulo; salida = cuando la
operación de referencia alcanza el corte real, o el último ticket si el módulo se
cerró sin llegar; la OF pasa a `TERMINADA` cuando todos sus módulos tienen salida.

Un módulo sin ruta en BASE sigue resolviéndose con los N°OP realmente reclamados,
y esas operaciones van marcadas con `*` (`en_base: false`).

## Rendimiento

Medido en producción: 149 OF · 910 módulos · 9.595 operaciones.

| | Tiempo | Respuesta |
|---|---|---|
| antes | 4,3 s | 281 kB |
| ahora, sin filtro (149 OF) | 4,3 s | 1,7 MB |
| ahora, un mes (89 OF) | 3,7 s | 1,2 MB |

La respuesta baja con las OF seleccionadas. El piso de ~3,5 s es el recorrido de
`reclamos`, que crece con la historia aunque se filtre; lo que el filtro acota —y es
lo que revienta el gateway y la descarga— es el **tamaño** de la respuesta. Al ritmo
actual, ~100 OF nuevas al mes a ~12 kB cada una con su detalle, sin filtro esto
llegaría a ~8 MB y ~30 s alrededor de los 6 meses: el gateway cortaría la carga
antes incluso de que la descarga molestara.

Seis veces más datos a un costo parecido porque los arreglos JSON de módulos y de
operaciones se arman **agrupando** (`opsjson` / `modjson`) y no con subconsultas
correlacionadas por módulo: con el correlacionado la misma respuesta tardaba
**7,4 s**, porque recorría las 9.595 operaciones una vez por cada uno de los 910
módulos. Es una vista solo de ingeniería (escritorio) y se pide a mano con
**Cargar**, así que no entra en la carga del cambio de turno (ver parche 67).

## Frontend

- `ingenieria.html` — fuera el `<select id="avofNivel">` y el check *Solo terminadas*;
  entran dos `<input type="month">` (Desde / Hasta). En la barra de control quedan
  Desde, Hasta, Buscar, Cargar y Descargar.
- `ingenieria.js` — `avofMesesDefecto` propone este mes y los dos anteriores;
  `avofRango` traduce los `YYYY-MM` de los inputs a fechas (el *hasta* se estira al
  último día del mes, y en blanco va `null`); `cargarAvof` llama a
  `fn_of_trazabilidad` con `p_desde`/`p_hasta` y sin `p_nivel`;
  `avofPintar` pinta las seis columnas y todas las OF; `avofCuadro` arma una fila por
  operación con el área y el módulo agrupados por `rowspan`, y marca la operación
  final (es la que decide salida y estado); `avofPct` dibuja la barra de porcentaje;
  `avofOfCod` resuelve el código de 10 dígitos (lo manda la RPC, se recalcula en el
  cliente por si la respuesta viene de una versión anterior); `descargarAvof` genera
  las tres hojas.
- `style.css` — clases `.avof-ops`, `.avof-nop`, `.avof-op-fin` y `.avof-pct*`,
  sobre la paleta existente (`--azul`, `--exito`, `--alerta`, `--enlace`).

## Cómo se comprobó

- `fn_of_trazabilidad` ejecutada contra producción, con y sin `p_nivel`: `ok: true`,
  149 OF, `nivel: ULTIMA`, y `n_mods` / `n_listos` / la operación de referencia del
  módulo intactos para el frontend viejo.
- `of_cod` verificado sobre datos reales: 10219 → 4000010219. Las 149 OF de la base
  son numéricas y de 5 dígitos como máximo, así que el código siempre sale de 10.
- `fn_of_trazabilidad_v2` ya no existe en el esquema.
- El cuerpo de la función en `sql/parche_68.sql` coincide byte a byte (mismo md5)
  con el que está desplegado.
- Pintado y Excel probados en Node y en Chromium con la respuesta real de la RPC:
  todas las filas del detalle cierran sus 6 columnas contando los `rowspan`, el
  buscador filtra, y las tres hojas salen con el orden de columnas pedido.
- La regla del periodo, contra producción y sobre una OF terminada real (9840,
  entrada 17-ago, salida 18-ago): sale eligiendo **solo su día de inicio**, sale
  eligiendo **solo su día de fin**, y no sale un mes después. Agosto devuelve 97 OF
  y setiembre 89 sobre un total de 149: las 37 de diferencia son las que se
  solapan, y en ambos meses traen las mismas fechas de entrada y salida.
- El rango en el navegador: por defecto propone los tres meses y manda
  `p_desde 2026-07-01` / `p_hasta 2026-09-30`; cambiando a ene–feb manda
  `2026-01-01` / `2026-02-28`; en blanco, la cabecera dice *toda la historia*.
