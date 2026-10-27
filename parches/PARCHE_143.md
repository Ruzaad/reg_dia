# Parche 143 — Adicionales por OF también en ACABADO

## Problema
En ACABADO hay desmanches (y similares) que siempre aparecen en los cortes: no son operación del balance, porque de 100 prendas solo 40-50 se desmanchan. «Adicionales por OF» no aceptaba ACABADO («En ACABADO usa Operaciones sin OF»).

## Cambio
- `fn_opad_guardar`: se quita el rechazo de ACABADO; el resto queda idéntico al parche 91. `fn_opad_listar` y `fn_opad_registrar` ya servían para cualquier área.
- Sus minutos cuentan para la persona; no suman al avance de la OF (`fn_acabado_ofs` cuenta por N°OP y la adicional no tiene).
- Front: ACABADO sale en el selector de Ingeniería › Adicionales por OF, y en el celular del operario de Acabado aparece la tarjeta ADICIONALES dentro de la OF.

## Verificar
```sql
select pg_get_functiondef('public.fn_opad_guardar(text,uuid,bigint,text,text,text,text,numeric,numeric,text,text,boolean)'::regprocedure) not like '%usa Operaciones sin OF%' as ok;   -- true
```

## Deshacer
Correr `parche_143_rollback.sql`.
