# Parche 198 — Estructura: agregar solo personal ya registrado

**Problema:** el modal "Agregar a la estructura" permitía escribir un DNI y nombre nuevos, duplicando la creación de personal que solo debe hacerse en Personal › CRUD.

**Cambio:** `fn_estructura_candidatos` lista solo personal ACTIVO que no está en la estructura del mes (búsqueda por nombre, DNI o usuario, máx. 40). `fn_estructura_agregar` asigna a esa persona (debe existir y estar activa) y rechaza duplicados. Sin tablas nuevas; `fn_estructura_guardar` sigue para editar. En el front, Cargo pasa a **Rol** en Personal y a **Tipo de Operario** en Estructura (solo etiquetas; las columnas `operarios.cargo` y `estructura_mes.cargo` siguen independientes).

**Verificar:** `select fn_estructura_candidatos(...)` no devuelve a quien ya está en el mes; agregar dos veces a la misma persona devuelve "Esta persona ya está en la estructura de este mes".

**Deshacer:** `sql/parche_198_rollback.sql`.
