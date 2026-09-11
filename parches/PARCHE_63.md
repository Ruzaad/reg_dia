# PARCHE 63 — Seguridad del login

## Problema encontrado
- `operarios.pin` se guardaba en texto plano (197 filas, 4 dígitos).
- `fn_login` comparaba `pin = p_pin` sin ningún límite de intentos.
- Es invocable por cualquiera con la anon key (que está publicada en
  `app.js`) → un DNI conocido se puede probar por fuerza bruta (10,000 PIN)
  sin que nada lo frene.
- El linter de seguridad de Supabase marcó 127 funciones `SECURITY DEFINER`
  ejecutables por `anon`/`authenticated`, incluidas ~22 funciones internas
  (prefijo `_`) que solo debían usarse desde otras funciones, no desde
  `/rest/v1/rpc/_algo` directo.
- 15 funciones `SECURITY DEFINER` sin `search_path` fijo (riesgo de
  secuestro de esquema).

## Cambio
1. **PIN con hash bcrypt** (`pgcrypto`, ya estaba instalado): se hashean los
   197 PIN existentes una sola vez. `fn_login` y `fn_cambiar_pin` comparan
   con `crypt()`.
2. **Bloqueo por intentos**: 2 columnas nuevas en `operarios`
   (`login_fallos`, `login_bloqueado_hasta`). 5 fallos → bloqueo de 15 min.
   Se resetea al loguear bien.
3. **search_path fijo** en `_auth`, `_ing`, `fn_login`, `fn_cambiar_pin`,
   `fn_asistencia_dia`, `fn_bases_existentes`, `fn_bases_listar`,
   `fn_mi_dia`, `fn_reclamados`, `fn_reclamar_lote`, `fn_tickets_dia`.
4. **REVOKE EXECUTE** de `anon`/`authenticated` en las ~22 funciones
   internas (`_auth`, `_ing`, `_ruta`, `_deshacer_troceo`,
   `_base_resecuenciar`, etc.). Las funciones `fn_*` siguen pudiendo
   llamarlas (mismo dueño de la función = no necesita el permiso).

## ⚠️ Importante — cambia el flujo manual de reseteo de PIN
Antes, para resetear el PIN de alguien (olvidó su clave) se hacía con un
`UPDATE operarios SET pin = '1234' WHERE dni = '...'` directo. **Eso ya no
funciona** — dejaría el PIN en texto plano y roto. A partir de este parche,
resetear un PIN manualmente se hace así:

```sql
update operarios set pin = crypt('1234', gen_salt('bf')), login_fallos = 0,
  login_bloqueado_hasta = null where dni = '12345678';
```

## Riesgo / rollback
El hasheo de PIN **es irreversible** (no se puede recuperar el PIN en texto
plano desde el hash — es la idea). Si algo sale mal con el login después de
aplicar esto, hay que revisar `fn_login` primero, no la tabla. El REVOKE de
funciones internas no rompe nada porque las funciones `fn_*` que las llaman
tienen el mismo dueño.

## Pendiente / no incluido en este parche
- Rate limiting por IP (esto es solo por DNI). Si se quiere, se puede sumar
  con una tabla de intentos por IP, pero requiere que el edge/gateway pase
  la IP a la función.
