# PARCHE 67 — Carga por OF (arregla el "Failed to fetch" del cambio de turno)

## El incidente
El viernes 11 el personal no podía ingresar: "Failed to fetch" aunque el
celular tuviera internet.

## Causa raíz (logs del viernes y sábado, hora Lima)
| Función | Errores | Tiempo |
|---|---|---|
| `fn_tickets_area` | 27× error 500 | 6.7s promedio, **39.8s máximo** |
| `fn_reclamar` | 6× 504 | ~5.6s — el operario no podía reclamar |
| `fn_login` | 1× 500 | 3.6s — **"no puedo ingresar"** |
| `fn_mi_dia`, `fn_residuales`, `fn_mis_paquetes`, `fn_areas_config_listar` | 504 | 5-10s |

Pico del incidente: **2026-09-11 23:15 UTC (18:15 Lima) → 1,146 requests en
15 minutos, 39 errores.** Es el cambio de turno.

`fn_tickets_area` devolvía TODO el catálogo del área en un solo JSON:

| Área | Tickets | JSON |
|---|---|---|
| SACO COSTURA | 53,194 | ~15 MB |
| CAMISA COSTURA | 38,351 | ~11 MB |
| PANTALON COSTURA | 26,045 | ~7.6 MB |

Medido en vivo: **1.89s de Postgres puro** para SACO COSTURA, con un sort que
se desbordaba a **disco (6.5MB)**. Y en la misma carga inicial iba
`fn_reclamados`, que en CAMISA son **41,465 filas (~2.5MB)** más.

Cuando ~150 personas entran a la vez, esas llamadas saturan las conexiones del
pooler y el ancho de banda del proyecto. Todo lo demás —**el login incluido**—
queda esperando hasta que el gateway corta la conexión. En el navegador eso se
ve exactamente como "Failed to fetch": el pedido nunca llegó a responder.

## Qué cambió

### Base de datos (2 funciones NUEVAS, ninguna existente se rompió)
- **`fn_ofs_area(p_dni, p_token, p_area)`** — lista liviana de OF del área con
  su conteo "X de Y libres". Devuelve 24 a 41 filas (~1.5 KB) en vez de 53 mil.
  Medido: **291ms**.
- **`fn_tickets_of(p_dni, p_token, p_area, p_of)`** — tickets de UNA OF, más su
  estado de reclamo (`tickets` + `reclamados` en la misma respuesta, para no
  tener que pedir `fn_reclamados` del área entera). Medido: **31.8ms**.
- Índice nuevo `tickets_cache(area, o_f, n_op, paq)` — elimina el sort a disco.
- **`fn_tickets_area` NO se tocó**: la versión del frontend que ya estaba
  publicada en Vercel la sigue usando y debe seguir funcionando mientras se
  despliega la nueva. Queda sin uso desde este parche.

### Frontend (`app.js`, solo el flujo del operario)
- Al entrar al área ya no se baja el catálogo: se baja la lista de OF.
- Al elegir una OF se bajan los tickets de esa OF (y solo una vez por sesión).
- El buscador de OF lee el conteo ya calculado por el servidor, en vez de
  recorrer decenas de miles de tickets **en cada tecla**.
- `fn_reclamados` (área completa) solo se pide en áreas que aún leen el Sheet
  (hoy solo PANTALON COSTURA). En las demás el estado de reclamo llega por OF.
- El botón de recargar refresca solo la OF abierta.
- Supervisora, ingeniería y ACABADO **no se tocaron** (no usan este flujo).

## Resultado
Carga inicial del operario: de **7-15 MB** a **~2 KB**. Al abrir una OF se bajan
unas decenas de KB.

## Corrección posterior (mismo día): ingeniería quedaba en blanco

Al publicar el parche, ingeniería dejó de cargar: entraba con su sesión y la
pantalla se quedaba estática, sin ninguna función.

Causa: `ingenieria.html` carga **los dos** archivos (`app.js` y luego
`ingenieria.js`), que comparten el ámbito global. El parche 67 declaró
`let OFS` en `app.js`, y `ingenieria.js` ya tenía `let OFS` en su línea 2201.
Dos `let` con el mismo nombre en el mismo ámbito es **SyntaxError**:
`ingenieria.js` no se parseaba y ninguna de sus funciones llegaba a existir.
El login seguía funcionando porque eso vive en `app.js`.

Arreglo: las variables nuevas de `app.js` pasaron a llamarse `OF_LISTA` y
`OF_CARGADAS`. No se tocó nada de `ingenieria.js`.

**Cómo no repetirlo:** antes de agregar una variable global a `app.js`, correr
`cat app.js ingenieria.js > /tmp/x.js && node --check /tmp/x.js`. Eso reproduce
exactamente cómo las carga `ingenieria.html` y detecta la colisión al instante.
Hoy pasa limpio.

## Pendiente / a vigilar
- El conteo "X de Y libres" del buscador no incluye residuales (7 filas en toda
  la base). Al abrir la OF sí aparecen. Diferencia cosmética.
- PANTALON COSTURA sigue leyendo su hoja de Google completa (`usa_almacen =
  true`). Ese peso es aparte de Supabase; se va solo cuando esa área termine de
  migrar, como ya hizo CAMISA.
- Falta probarlo con gente real: el lunes en el cambio de turno es la prueba.
