# Parche 197: corrige el registro de varios artículos

## Problema
`fn_bases_agregar_varios` (parche 196) fallaba con «UPDATE requires a WHERE clause»: la base bloquea los UPDATE sin WHERE.

## Cambio
Se recrea la función con `where true` en ese UPDATE.

## Verificar
En Bases › Varios artículos, REGISTRAR TODOS guarda el artículo sin error.
