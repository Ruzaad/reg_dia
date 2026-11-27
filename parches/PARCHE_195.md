# Parche 195: OFs editables, rol Admin y limpieza

## Problema
- No se podía corregir ni borrar una OF registrada por error (p. ej. la 0678).
- Admin dependía de una sola persona y no había forma de darlo a otra.
- Las tablas de incentivo no tenían quién las editara con control.
- Quedaban funciones de pantallas retiradas (Paquetes sueltos, Carga vs capacidad).

## Cambio
- `fn_of_editar` (OF, Artículo, Prenda) y `fn_of_eliminar`: piden la pestaña OFs registradas, rechazan OF duplicada y rechazan cambiar o borrar si ya tiene tickets, reclamos, generación, lotes, ajustes u operaciones extra. Dejan rastro en `correcciones_log`.
- `fn_incentivos_tabla_guardar` / `fn_bono_modular_tabla_guardar` guardan la tabla completa (agregar, editar y quitar %), validan duplicados y montos (hasta 2 decimales) y no dejan la tabla vacía; el % ya no se limita a 80-100. El cálculo de la quincena sigue topando en 100 % hasta que se active la tabla nueva.
- `fn_bases_agregar_varios`: registra varios artículos nuevos en un lote; salta los que ya existen y devuelve los inválidos con motivo.
- `fn_admin_asignar`: da o quita Admin (solo Ingeniería; siempre queda un Admin activo).
- Se borran `fn_paquetes_sueltos`, `fn_paquetes_sueltos_of`, `_sueltos`, `_sueltos_areas`, `fn_carga_capacidad`, `fn_ofs_completadas`, `fn_ofs_completar_varias` (antes se comprueba que nada más las use; sin CASCADE). Se conservan `fn_avance_of`, `fn_avance_of_ops` y `fn_of_completar`.
- Fuera de SQL: borrar la Edge Function `ef-gemini` en Supabase.

## Verificar
`select fn_of_eliminar(...)` sobre una OF sin tickets devuelve ok; sobre una con reclamos devuelve `en_uso`.
Deshacer: `sql/parche_195_rollback.sql`.
