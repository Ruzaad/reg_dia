# Parche 144 — PCP en CHRONOS: meta, programa de costura y salida de corte

## Problema
PCP no estaba en el sistema: la meta del mes se manejaba aparte, el programa de costura vivía en un Excel y lo que sale de corte en el Google Sheets (hoja NOTI_CORTE). El operario no sabía cuál era su meta del día. `metas_mes` (parche 130) existía pero vacía y sin RPC.

## Cambio
- Tablas nuevas, solo con la versión vigente para no cargar la base:
  - `pcp_programa`: el programa de costura (hojas CAMISA, PANTALON y SACO del Excel de PCP). Subir otro lo reemplaza entero.
  - `pcp_corte`: la hoja NOTI_CORTE (FECHA, ORDEN DE FABRICACION, ARTICULO, COLOR, CLIENTE, CANTIDAD). Cada carga reemplaza solo las fechas que trae.
  - `pcp_cargas`: quién y cuándo hizo la última carga de cada tipo.
- Metas en `metas_mes`: CORPORACION y una por AREA (minutos del mes).
  - Meta del día del área = meta del mes ÷ días laborables (`_laborable`).
  - Disponible del área = personas MOD de la estructura del mes × `_jornada`.
  - Meta del día de una persona = su `_jornada` × (meta del día del área ÷ disponible del área). Si PCP carga una meta OPERARIO, manda esa.
- RPC nuevas (no se toca ninguna existente):
  - `fn_pcp_resumen(p_dni, p_token, p_mes)`: lectura, pestaña `pasoPcp`. Metas, producido por área y día, programa contra producido, OF vencidas sin FINALIZADO, OF que arrancan costura sin corte completo y salida de corte por día.
  - `fn_pcp_meta_guardar`, `fn_pcp_programa_cargar`, `fn_pcp_corte_cargar`: escriben el administrador o quien edita alguna área y tiene la pestaña PCP.
  - `fn_mi_meta(p_dni, p_token)`: la meta del día de quien entra al celular.
- Front: Ingeniería › Planificación › **PCP · Meta y programa** (pcp.js) y la tarjeta «Hoy» del operario muestra Meta del día, lo que lleva y cuánto le falta.

## Verificar
```sql
select count(*) = 7 as ok from pg_proc where proname in
  ('fn_pcp_resumen','fn_pcp_meta_guardar','fn_pcp_programa_cargar','fn_pcp_corte_cargar','fn_mi_meta','_pcp_editor','_pcp_meta_area');
select count(*) = 3 as ok from information_schema.tables where table_name in ('pcp_cargas','pcp_programa','pcp_corte');
```
Luego en Permisos dar la pestaña «PCP · Meta y programa» a quien corresponda, subir el Excel del programa y poner las metas del mes.

## Deshacer
Correr `parche_144_rollback.sql`.
