# Parche 158 — Inicio: quita Apoyo de la consulta

**Problema:** Apoyo (parche 157) ya no se usa en el Inicio.

**Cambio:** `fn_inicio_resumen` vuelve a la definición del parche 151, sin `apoyo_min` ni `apoyo_pers`. Sirve haya corrido o no el 157. El front muestra Min. Produ., la meta pasa al encabezado de cada área y se quitan Falta/Excedente.

**Verificar:** `select fn_inicio_resumen('<dni>','<token>'::uuid)::text like '%apoyo%';` da false.
