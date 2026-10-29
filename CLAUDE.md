# CLAUDE.md — SAMITEX Tickets Virtuales

Responde siempre en **español**. Ruzaad (dueño del repo) no navega carpetas: dale el SQL listo para copiar y pegar, no rutas.

## Qué es
PWA estática (HTML/CSS/JS vanilla, **sin framework y sin build**) para registrar la producción de una planta de confección. Toda la lógica y los permisos viven en Supabase (RPC de Postgres). El front solo llama `rpc("fn_x", {...})`.

- **Operario**: PWA en el celular (`operario.html`). Supervisora: también celular (`supervisora.html`). **Ingeniería y oficina**: web de escritorio (`ingenieria.html`).
- Toda mejora cuida accesibilidad y velocidad: nada que agregue demora al celular del operario.

## Mapa del código
| Archivo | Para qué |
|---|---|
| `app.js` | Núcleo compartido: config Supabase, `rpc()` (l. ~362), sesión, login y todo el flujo del operario. Lo cargan las 4 páginas. |
| `ingenieria.js` | Vista de Ingeniería (el archivo más grande, ~7 200 líneas). |
| `rediseno.css` | Estilo vigente (paleta en variables CSS `--azul`, `--ocre`, …). `style.css` es la base vieja que sigue cargada debajo. |
| `dinamico.js` | Capa dinámica que se carga al final de cada página; reutiliza las funciones y RPC existentes. |
| `lotes.js` | Vista de lotes de REPROCESO (abrir, cerrar, avance, crear). El trabajo por tiempo de CORTE y DESPACHO quedó sin uso. |
| `supervisora-hoy.js`, `operario-inicio.js`, `sinsenal.js`, `pedidos.js` | Pantallas de supervisora, inicio del operario, modo sin señal, pedidos de tiempo. |
| `buscar.js`, `calidad.js`, `asistencia.js`, `feriados.js`, `incidencias.js`, `sueltos.js`, `prestadas.js`, `costos.js`, `inicio.js`, `pcp.js` | Módulos de Ingeniería (y algunos de supervisora). `pcp.js` = PCP: metas, programa de costura y salida de corte (parche 144); `pcp-seguimiento.js` = cronograma PDF, Gantt y gráficos (parches 146-147); `cronogramas.js` = Cronogramas con lo real y subida de archivos (parche 152). |
| `sql/parche_N.sql` + `sql/parche_N_rollback.sql` + `parches/PARCHE_N.md` | Cambios de base, en orden. |
| `supabase/functions/ef-gemini/` | Edge function (Gemini para Auditoría). |
| `verificar_enlace.py` | Genera un SQL que comprueba que cada `rpc(...)` del front exista en Supabase con los mismos parámetros. |

No hay tests ni linter. Para probar, abre las páginas en un navegador (Playwright está disponible en la nube).

## Grafo del código (graphify) — úsalo primero
Herramienta interna para ubicar código sin releer archivos enteros. **No se publica**: `graphify-out/` está en `.gitignore` y `.vercelignore`.

- Se arma solo al empezar cada sesión: `.claude/settings.json` corre `scripts/grafo.sh` (instala `graphifyy[sql]` si falta y arma o actualiza `graphify-out/graph.json`; ~10 s, solo AST local, sin LLM ni claves). Si no está, córrelo a mano: `bash scripts/grafo.sh`.
- Un hook te recuerda consultar el grafo antes de buscar o leer archivos, y `/graphify` queda disponible (`.claude/skills/graphify/`). `.graphifyignore` deja fuera los rollback, así cada función sale con la versión de su parche, no repetida.
- Antes de abrir archivos: `graphify query "<pregunta>"`, `graphify explain "<función>"`, `graphify path "<A>" "<B>"`, `graphify affected "<X>"`. Abre solo el rango de líneas que indique.
- Las funciones SQL salen como `public.fn_x()` con su `sql/parche_N.sql`; el front las llama por texto (`rpc("fn_x")`), así que para cruzar front y base busca también con `query`.
- Tras cambiar código: `graphify update .`

## Base de datos (lo más delicado)
- Proyecto Supabase `lmlwomurgbbzolgbkwtp` (samitex-cost-acab).
- Cada cambio de base es un **parche numerado**: `sql/parche_N.sql`, su `sql/parche_N_rollback.sql` y `parches/PARCHE_N.md` (problema, cambio, cómo verificar). **Siguiente libre: 153.** El 117 está reservado (plantillas de permisos) y el 108 no se usa. Si hay varios hilos a la vez, el coordinador asigna los números.
- **Los PRs nunca ejecutan SQL en producción.** Solo Ruzaad lo corre en el SQL Editor de Supabase. Se puede LEER producción para verificar, nunca escribir. Si son varios parches, se le arma UN SQL maestro en una sola transacción (`begin; … commit;`), con su deshacer.
- El rol `anon` tiene **`statement_timeout` de 3 s**, y un `set statement_timeout` dentro de la función no alarga la sentencia en curso: toda RPC nueva debe medir < 3 s con datos reales.
- Conviven despliegues con versiones viejas del front contra la misma base: **no rompas una RPC que el front ya usa**. Crea una nueva (u otra sobrecarga) y deja la vieja. Se mantienen a propósito las sobrecargas viejas de `fn_acabado_registrar`, `fn_personal_editar`, `fn_movimiento_hora` y la columna `tickets_cache.actualizado`.
- Jornada y días laborables: usa `_jornada` y `_laborable` (parche 120), nunca 575 min ni "lunes a viernes" escritos a mano.
- Última y penúltima operación de un artículo: usa `_ultimas(área)` (parche 125; el analista puede fijarlas en Bases › ★ ÚLTIMA / PENÚLTIMA), nunca `max(n_op)` a mano. En el front: `ultimasArea()` / `calcularFinalesBase(filas, ult)`.
- Permisos: `_admin`, `_ing`, `_lector`, `_auth` validan dentro de cada RPC.

## Despliegue
- Se trabaja **directo sobre `main`** (rama de trabajo → PR → fusionar a `main`). `qa` ya no se usa.
- Al fusionar a `main`, Vercel despliega solo (planta-ruzaad.vercel.app). Netlify y GitHub Pages siguen sirviendo a parte del personal contra la misma base; Ruzaad los republica a mano.
- El deploy se comprueba por los estados del commit en GitHub (el proxy de la nube no llega a `*.vercel.app`).

## Seguridad
Nada sensible en GitHub. Las claves van en secretos de Supabase (p. ej. `GEMINI_API_KEY`) o variables de Vercel. La URL y la clave publicable (`anon`) de `app.js` son públicas por diseño; la seguridad está en las RPC.

## Cómo trabajar
1. Cambios quirúrgicos y mínimos; no reestructures lo que ya funciona.
2. UI: respeta la paleta y los componentes de `rediseno.css`, nada de estilos aislados. El estilo de referencia es la pantalla de Asistencia.
3. Antes de **borrar** cualquier cosa (archivo, función, tabla, columna) pide confirmación.
4. Código directo, pocos comentarios. Comentarios y textos de la app en español.
5. Si una regla de negocio no se deduce del código, pregunta.
