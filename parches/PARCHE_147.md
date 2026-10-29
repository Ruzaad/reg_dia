# Parche 147 · PCP: OF de planta, minutos por penúltima operación y sin endpoint

**Problema.**
- Los archivos de PCP traen la OF de 10 dígitos (`4000010190`) y el sistema, NOTI_CORTE y los tickets usan la OF de planta (`10190`). El cruce nunca coincidía: todo salía «cortado 0».
- Los minutos producidos sumaban los minutos de cada ticket; PCP los quiere como prendas de la penúltima operación × tiempo estándar del artículo.
- El endpoint del parche 146 no se quiere.

**Cambio.**
- `_of_planta(texto)`: quita el «4» y los ceros de la OF de 10 dígitos. Las pantallas muestran la OF de planta.
- `_pcp_prod(desde, hasta)`: por día y área, suma las prendas de la penúltima operación (`_ultimas`, respeta la selección manual) × S.A.M del artículo (suma de los estándares de sus operaciones en Bases). Si el área o el artículo no tiene base, cuenta los minutos del ticket. Mide ~0,8 s por mes.
- `fn_pcp_resumen` y `_pcp_seguimiento` usan lo anterior (Gantt hasta 100 filas, con scroll en pantalla).
- Se borran `fn_pcp_api`, `fn_pcp_api_clave_crear`, `fn_pcp_api_claves`, `fn_pcp_api_clave_revocar` y la tabla `pcp_api_claves`.
- Front: avisos como tarjetas en una línea que llevan a su sección, Gantt de 10 filas con filtro, ícono de PCP en el menú.

**Cómo verificar.** Ingeniería › PCP: el cronograma debe mostrar «cortado» mayor que 0 en las OF que ya salieron de corte, y «Minutos producidos» cambia (ahora por penúltima operación). `select * from _pcp_prod('2026-10-01','2026-10-31');` devuelve fecha, área, prendas y minutos.

**Deshacer.** `sql/parche_147_rollback.sql`.
