
PROYECTO: SAMITEX Tickets (PWA estática HTML/CSS/JS + Supabase RPC + Sheets).
Código real en `Areas-planta` (no en `code`). Deploy: frontend push GitHub→Netlify (estático, sin build); BD = parches SQL manuales en Supabase.

CÓMO TRABAJAR (obligatorio):

1. Graphify PRIMERO: usa `/graphify` o `graphify query/explain/path/affected` sobre `graphify-out/graph.json` para ubicar y relacionar código. NO releas el proyecto entero; abre solo el rango de líneas que el grafo indique. Tras cambiar código: `graphify update "…\Areas-planta"`.
2. Si escribes/rediseñas UI: aplica las skills frontend-design, ui-ux-pro-max e impeccable, RESPETA la paleta existente (variables CSS --azul/--ocre/etc.) e integra componentes al sistema (nada de estilos aislados).
3. Cambios quirúrgicos: superficie mínima; NO reestructures drásticamente lo que ya funciona.
4. Antes de BORRAR cualquier cosa (archivo, función, tabla, columna): pide confirmación.
5. Código óptimo y directo: poco texto y pocos comentarios; minimiza tokens.
6. Mantén los entregables .md: `sql/parche_N.sql` + `parches/PARCHE_N.md` cuando haya cambios de BD, y actualiza `DOCUMENTACION.md` cuando aplique.
7. Ante ambigüedad o regla de negocio no deducible del código: detente en ese punto y pregunta; no asumas.
