# Parche 134 — Cerrar varias OF y ver las cerradas

**Problema.** El botón "No vigente" (parche 132) cierra una OF por vez y no hay dónde ver lo ya cerrado para deshacer un error.

**Cambio.** Dos funciones nuevas, sin tocar las existentes:
- `fn_ofs_completar_varias(dni, token, items jsonb, completar)`: cierra o reabre una lista `[{area, of}]`. Solo INGENIERIA.
- `fn_ofs_completadas(dni, token, area)`: lista las OF con módulos cerrados (artículo, módulos, quién, cuándo).

En Carga vs capacidad: casillas por fila, "No vigente (n)" para cerrar las marcadas y la sección "OFs cerradas" con "Reabrir".

**Verificar.**
```sql
select proname from pg_proc where proname in ('fn_ofs_completar_varias','fn_ofs_completadas');
```
Deben salir las dos.

**Deshacer.** `sql/parche_134_rollback.sql`.
