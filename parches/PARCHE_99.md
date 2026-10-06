# PARCHE 99 — Crear usuarios de oficina (COSTOS) con usuario en vez de DNI

## El problema

Al crear a `vbendita` con cargo COSTOS no se podía guardar. La tabla `operarios`
tenía el check `operarios_dni_check`: el DNI debía tener 8 dígitos, **salvo si el
cargo era INGENIERIA**. Usuarios como LFABIAN o ALOPEZ pasaban por ser INGENIERIA;
el cargo COSTOS (que el parche 95 abrió para la oficina) chocaba con el check.

(El error de la captura, "null value in column pin", sale de insertar la fila a
mano en Supabase: el PIN cifrado lo pone `fn_personal_crear`. Hay que crear al
usuario desde Ingeniería · Personal · Agregar personal.)

Lo de "antes tampoco dejaba agregar a alguien a INGENIERIA" era otra cosa: hasta
el parche 95 el desplegable de cargo no ofrecía INGENIERIA. Hoy ALOPEZ (admin) ve
INGENIERIA y COSTOS.

## El cambio (`sql/parche_99.sql`)

`operarios_dni_check` pasa a: DNI de 8 dígitos **o** un cargo que no sea
OPERARIO, ESTAJERO ni SUPERVISORA. El personal de planta sigue exigiendo DNI.

Sin cambios de front. Rollback: `sql/parche_99_rollback.sql` (falla si ya existe
un usuario COSTOS no numérico).

## Cómo se comprobó

Postgres local: con el check viejo, `vbendita`/COSTOS falla con la misma
violación; con el nuevo entra, y `pepito`/OPERARIO y `sup1`/SUPERVISORA siguen
rechazados. El parche corre dos veces sin error.
