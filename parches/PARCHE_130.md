# Parche 130 — Asistencia en bloque desde la Matriz, borrar estados y estructura por meses

**Problema:** en Personal › Matriz cada estado se ponía celda por celda, así que cargar la quincena de PANTALON o SACO tomaba mucho. No había cómo borrar un estado ya puesto. «Estados por rango» marcaba también sábados y domingos (482 filas de fin de semana en la base). Además, después de aplicar estados en una pestaña, la Matriz seguía mostrando lo de antes hasta cambiar de fecha o área.

**Cambio (base):**
- `fn_asistencia_celdas(p_dni, p_token, p_celdas jsonb, p_estado)`: pone un estado en muchas celdas `[{dni, fecha}]` de una vez (máx. 5000). Con `p_estado` vacío las borra. Al poner, salta sábados, domingos y feriados con `_laborable` (parche 120); al borrar no salta nada, así se pueden limpiar los de fin de semana. Valida con `fn_validar_ingenieria`; el permiso por área lo sigue haciendo `perm_area_trg`.
- `fn_asistencia_matriz`: misma firma y salida, más `no_lab` = `{fecha: SAB|DOM|FER}`.
- `metas_mes` (vacía): meta mensual de minutaje y prendas por CORPORACION, AREA u OPERARIO (`mes` = día 1; OPERARIO guarda también su área). Con `perm_area_trg` por `area`. Sin pantalla ni RPC todavía: es para cuando PCP cargue las metas.
- `fn_asignar_estado_rango` no se toca (la usan los despliegues viejos).

**Cambio (front):**
- Matriz: se seleccionan celdas, una fila (tocando el nombre), un día (tocando la cabecera) o un bloque (Mayús + clic); «Seleccionar vacías» marca todas las celdas sin estado en días laborables. Luego «Aplicar a seleccionadas» o «Borrar estado». Fines de semana y feriados salen en gris y no se marcan.
- Matriz por meses: selector de mes y botones 1ra quincena / 2da quincena / Mes completo. Columnas Pres., Aus. y Vacías por persona (días laborables).
- Estados por rango usa `fn_asistencia_celdas`, así que ya no marca sábados, domingos ni feriados.
- `dinamico.js`: tras guardar asistencia, las demás pestañas se recargan al entrar (antes quedaban con datos viejos). El buscador Ctrl+K vuelve a encontrar personas (llamaba a `fn_personal_listar` sin `p_incluir_inactivos` y fallaba).

**Verificar:**
```sql
select count(*) from pg_proc where proname = 'fn_asistencia_celdas'; -- 1
select count(*) from information_schema.tables where table_name = 'metas_mes'; -- 1
```
En la app: Personal › Matriz › PANTALON › 1ra quincena, tocar dos nombres, elegir VACACIONES y Aplicar.

Rollback: `parche_130_rollback.sql` (devuelve `fn_asistencia_matriz`, borra `fn_asistencia_celdas` y `metas_mes`).
