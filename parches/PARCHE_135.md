# Parche 135 — Horas extra de la supervisora con fecha elegida

**Problema.** La supervisora solo podía registrar horas extra de hoy o de ayer, y no horas trabajadas en sábado, domingo o feriado.

**Cambio.**
- `fn_sup_he_lista` (misma firma) agrega `jornada`: 0 si ese día no es laborable.
- `fn_sup_horas_fecha` (nueva): cualquier día de los últimos 15, hasta hoy. Día laborable: hora extra, hasta 4 h por persona. Día no laborable: horas trabajadas de 0.5 a 12 h, guardadas como en Ingeniería (`JORNADA SABADO/DOMINGO/FERIADO`); registrar de nuevo reemplaza lo anterior.
- `fn_sup_horas_extra` queda igual para los despliegues viejos.

**Verificar.**
```sql
select proname from pg_proc where proname in ('fn_sup_horas_fecha','fn_sup_he_lista');
```
Deben salir las dos.

**Deshacer.** `sql/parche_135_rollback.sql`.
