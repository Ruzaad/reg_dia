# PARCHE 68 — Resumen de OF: todas las operaciones del balance

## Qué se pidió
En **Resumen de OF**:

- La tabla principal queda en **Artículo · OF · Corte real · Entrada · Salida · Estado**
  (se retira la columna *Módulos listos*).
- Al abrir ▾, el detalle muestra por módulo: **área, módulo, todas las operaciones
  del balance, producida, porcentaje y estado** (EN PROCESO / COMPLETADO).
- Se elimina el filtro *última / penúltima operación del módulo*. Queda solo el
  buscador y se listan **todas las OF**, terminadas y en proceso, en una sola tabla.
- El Excel pasa a tres hojas: **GENERAL**, **MODULO** y **OPERACION FINAL**.

## Qué cambió en la base

Función **nueva**: `fn_of_trazabilidad_v2(p_dni, p_token)` — ya sin `p_nivel`.

`fn_of_trazabilidad` (la de tres argumentos) **no se toca ni se borra**: el mismo
repo está publicado en Netlify, Vercel y GitHub Pages contra esta misma base, y un
push a `main` no actualiza los tres a la vez. Mientras haya un frontend viejo, esa
función tiene que seguir respondiendo. Borrarla es un paso posterior, con
confirmación, cuando los logs ya no registren llamadas.

Diferencias de cálculo frente a la versión anterior:

| | `fn_of_trazabilidad` | `fn_of_trazabilidad_v2` |
|---|---|---|
| Operaciones por módulo | una (la última o la penúltima, según `p_nivel`) | **todas las del balance** |
| Referencia del módulo | dependía de `p_nivel` | siempre la **operación final** |
| Porcentaje | no existía | `producida / corte real`, por operación y por módulo |
| Estado de módulo/operación | `TERMINADO` / `EN PROCESO` | `COMPLETADO` / `EN PROCESO` |

Lo que **no** cambió: entrada = primer ticket del módulo; salida = cuando la
operación de referencia alcanza el corte real, o el último ticket si el módulo se
cerró sin llegar; la OF pasa a `TERMINADA` cuando todos sus módulos tienen salida.

Un módulo sin ruta en BASE sigue resolviéndose con los N°OP realmente reclamados,
y esas operaciones van marcadas con `*` (`en_base: false`).

## Rendimiento

Medido en producción: 149 OF · 910 módulos · 9.595 operaciones.

| Función | Tiempo | Respuesta |
|---|---|---|
| `fn_of_trazabilidad` | 4,3 s | 281 kB |
| `fn_of_trazabilidad_v2` | 4,6 s | 1,7 MB |

Seis veces más datos casi al mismo costo porque los arreglos JSON de módulos y de
operaciones se arman **agrupando** (`opsjson` / `modjson`) y no con subconsultas
correlacionadas por módulo: con el correlacionado la misma respuesta tardaba
**7,4 s**, porque recorría las 9.595 operaciones una vez por cada uno de los 910
módulos. Es una vista solo de ingeniería (escritorio) y se pide a mano con
**Cargar**, así que no entra en la carga del cambio de turno (ver parche 67).

## Frontend

- `ingenieria.html` — fuera el `<select id="avofNivel">` y el check *Solo terminadas*;
  en la barra de control quedan Buscar, Cargar y Descargar.
- `ingenieria.js` — `cargarAvof` llama a `fn_of_trazabilidad_v2`; `avofPintar` pinta
  las seis columnas y todas las OF; `avofCuadro` arma una fila por operación con el
  área y el módulo agrupados por `rowspan`, y marca la operación final (es la que
  decide salida y estado); `avofPct` dibuja la barra de porcentaje; `descargarAvof`
  genera las tres hojas.
- `style.css` — clases `.avof-ops`, `.avof-nop`, `.avof-op-fin` y `.avof-pct*`,
  sobre la paleta existente (`--azul`, `--exito`, `--alerta`, `--enlace`).

## Cómo se comprobó

- `fn_of_trazabilidad_v2` ejecutada contra producción: `ok: true`, 149 OF, y el
  detalle de una OF real trae las 9 operaciones del balance de su módulo con el
  porcentaje de cada una.
- Permisos idénticos a los de `fn_of_trazabilidad` (`anon`, `authenticated`,
  `service_role` con EXECUTE).
- Pintado y Excel probados en Node con la respuesta real de la RPC: todas las filas
  del detalle cierran sus 6 columnas contando los `rowspan`, el buscador filtra y las
  tres hojas salen con sus cabeceras.
