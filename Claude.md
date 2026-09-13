
PROYECTO: SAMITEX Tickets (PWA estática HTML/CSS/JS + Supabase RPC + Sheets).
El código vive en la raíz de este repo (`app.js`, `ingenieria.js`, `*.html`).
BD = parches SQL manuales en Supabase, proyecto `lmlwomurgbbzolgbkwtp`
(samitex-cost-acab). Frontend: estático, sin build.

DÓNDE ESTÁ PUBLICADO (verificado en los logs de Supabase, 13-set-2026):
hay TRES despliegues del mismo repo apuntando a la MISMA base de producción.
  · https://registro-planta.netlify.app  ← el que usa el personal (119 req/24h)
  · https://planta-blue.vercel.app       ← 15 req/24h
  · https://ruzaad.github.io             ← 12 req/24h
Antes de dar por publicado un cambio, confirma en CUÁL de los tres entró: un
push a `main` no garantiza que los tres se actualicen a la vez, y mientras no
lo hagan conviven versiones distintas del frontend contra la misma BD. Por eso,
al cambiar una RPC que el front ya usa, NO se rompe la vieja: se crea una nueva
y se deja la anterior hasta confirmar que ya nadie la llama (ver parche 67).

Para verificar que el front y Supabase siguen calzando: `verificar_enlace.py`.

CÓMO TRABAJAR (obligatorio):

1. Graphify PRIMERO: usa `/graphify` o `graphify query/explain/path/affected` sobre `graphify-out/graph.json` para ubicar y relacionar código. NO releas el proyecto entero; abre solo el rango de líneas que el grafo indique. Tras cambiar código: `graphify update "…\Areas-planta"`.
2. Si escribes/rediseñas UI: aplica las skills frontend-design, ui-ux-pro-max e impeccable, RESPETA la paleta existente (variables CSS --azul/--ocre/etc.) e integra componentes al sistema (nada de estilos aislados).
3. Cambios quirúrgicos: superficie mínima; NO reestructures drásticamente lo que ya funciona.
4. Antes de BORRAR cualquier cosa (archivo, función, tabla, columna): pide confirmación.
5. Código óptimo y directo: poco texto y pocos comentarios; minimiza tokens.
6. Mantén los entregables .md: `sql/parche_N.sql` + `parches/PARCHE_N.md` cuando haya cambios de BD, y actualiza `DOCUMENTACION.md` cuando aplique.
7. Ante ambigüedad o regla de negocio no deducible del código: detente en ese punto y pregunta; no asumas.
