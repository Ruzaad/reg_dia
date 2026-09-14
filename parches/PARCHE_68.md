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

## Qué cambió en la base

Se actualiza **`fn_of_trazabilidad`** manteniendo su firma:
`fn_of_trazabilidad(p_dni, p_token, p_nivel default 'PENULTIMA')`.

La firma no se toca a propósito. El mismo repo está publicado en Netlify, Vercel y
GitHub Pages contra esta misma base, y un push a `main` no actualiza los tres a la
vez: un frontend viejo que siga mandando `p_nivel` tiene que seguir resolviendo en
PostgREST. `p_nivel` se acepta y se ignora — la referencia del módulo es siempre su
operación final — y la respuesta conserva todos los campos que esos frontends pintan
(`nivel`, `n_mods`, `n_listos`, y por módulo `operacion`, `nop`, `producida`,
`cant_prog`, `ruta_base`, `es_acabado`).

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
| ahora | 5,5 s | 1,7 MB |

Seis veces más datos a un costo parecido porque los arreglos JSON de módulos y de
operaciones se arman **agrupando** (`opsjson` / `modjson`) y no con subconsultas
correlacionadas por módulo: con el correlacionado la misma respuesta tardaba
**7,4 s**, porque recorría las 9.595 operaciones una vez por cada uno de los 910
módulos. Es una vista solo de ingeniería (escritorio) y se pide a mano con
**Cargar**, así que no entra en la carga del cambio de turno (ver parche 67).

## Frontend

- `ingenieria.html` — fuera el `<select id="avofNivel">` y el check *Solo terminadas*;
  en la barra de control quedan Buscar, Cargar y Descargar.
- `ingenieria.js` — `cargarAvof` llama a `fn_of_trazabilidad` sin `p_nivel`;
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
