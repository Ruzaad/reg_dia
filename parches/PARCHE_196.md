# Parche 196: tablas de incentivo completas y varios artículos en Bases

## Problema
- Las tablas de incentivo no permitían agregar ni quitar porcentajes, ni pasar de 100 %.
- Registrar varios artículos nuevos exigía subir un Excel.

## Cambio
- `fn_incentivos_tabla_guardar` y `fn_bono_modular_tabla_guardar` (reemplazan las del 195): guardan la tabla completa, validan duplicados y montos (hasta 2 decimales), no dejan la tabla vacía; el % admite de 0 a 300. Solo Admin. El cálculo de la quincena sigue topando en 100 % hasta activar la tabla nueva.
- `fn_bases_agregar_varios`: registra varios artículos nuevos en un lote, salta los que ya existen y devuelve los inválidos con su motivo.

## Verificar
`select fn_bases_agregar_varios(...)` con un artículo existente lo devuelve en `duplicados` y no lo toca.
Deshacer: `sql/parche_196_rollback.sql`.
