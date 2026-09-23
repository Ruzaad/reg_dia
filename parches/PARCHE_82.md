# PARCHE 82 — Personal nuevo sin acceso, intentos restantes y cambios que se revertían

## Qué pasaba

**1. El personal nuevo no podía entrar, ni con la clave por defecto ni tras RESETEAR PIN.**
El parche 63 (11-set) pasó los PIN a bcrypt y `fn_login` compara con `crypt()`.
Pero `fn_personal_crear` (sus dos firmas) y `fn_personal_resetear_pin` siguieron
guardando `'1234'` / `'1111'` en texto plano. `crypt('1234', '1234')` nunca da
`'1234'`, así que todo el que se creó o se reseteó desde el 11-set quedaba fuera.
Caso real: DNI 10324831 tenía `pin = '1234'` sin hash y 4 fallos acumulados.

Además, el reseteo no limpiaba `login_fallos` ni `login_bloqueado_hasta`, y al
vencer un bloqueo el contador seguía en 5: el siguiente fallo volvía a bloquear
15 min al instante.

**2. No se veían los intentos restantes.** `fn_login` siempre respondía
"DNI o clave incorrectos".

**3. Cargo y categoría que "se cambian solos".** En la base solo
`fn_personal_editar` y `fn_personal_crear` escriben `cargo` y `categoria`
(no hay triggers, cron ni otra función que los toque). Lo que sí había:

- El select de **Cargo** solo trae OPERARIO, SUPERVISORA y ESTAJERO. Al editar a
  alguien de INGENIERIA caía en la primera opción y GUARDAR lo volvía OPERARIO.
- GUARDAR manda **todos** los campos tal como estaban al abrir el modal. Un modal
  abierto hace rato (otra pestaña, otro equipo, otra persona de ingeniería)
  pisaba lo que se había cambiado mientras, incluida el área actual que el
  operario cambia al reclamar tickets.

## Qué cambia

**Base (`sql/parche_82.sql`):**

- `fn_personal_crear` (8 y 9 parámetros) y `fn_personal_resetear_pin` guardan el
  PIN con `crypt(..., gen_salt('bf'))`. El reseteo limpia fallos y bloqueo.
- Se hashean los PIN que quedaron en texto plano (hoy, solo 10324831).
- `fn_login`:
  - "Clave incorrecta. Te quedan N intento(s)." y, al quinto, "Cuenta bloqueada 15 min".
  - Si está bloqueado dice cuántos minutos faltan.
  - Al vencer el bloqueo el contador arranca de cero.
  - Si algún PIN llega en texto plano lo acepta y lo rehashea en ese login.
  - El DNI inexistente sigue diciendo "DNI o clave incorrectos".

**Front (`ingenieria.js`):**

- Cargo y categoría incluyen siempre el valor actual entre las opciones.
- Al GUARDAR se relee a la persona; lo que no se tocó en el modal se toma de la
  base, así un modal viejo ya no revierte cambios ajenos.
- Al crear, avisa la clave inicial.

## Cómo comprobar

```sql
-- nadie con PIN sin hash
select count(*) from operarios where pin !~ '^\$2[aby]\$';   -- 0
```

Probado en una copia local (PostgreSQL 16 + pgcrypto): creación con las dos
firmas, reseteo, cuenta regresiva de intentos, bloqueo, vencimiento del bloqueo,
PIN heredado en texto plano, y que el parche se puede correr
dos veces.

## Volver atrás

`sql/parche_82_rollback.sql` deja `fn_login` como estaba en producción. No revierte la creación ni el
reseteo de PIN: la versión anterior es justamente el error.
