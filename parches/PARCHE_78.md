# PARCHE 78 — INCENTIVOS solo para el administrador maestro

## El permiso no va en el código

`ALOPEZ` no queda escrito en ningún `if` del frontend. Va en una columna nueva,
`operarios.es_admin`, y hoy la tiene solo ella:

```sql
update operarios set es_admin = true where dni = 'ALOPEZ';
```

Así, mover el administrador maestro o repartir permisos por analista más
adelante es un `UPDATE`, no un parche de frontend ni un redeploy.

Usuarios de ingeniería activos hoy: **ALOPEZ** (maestro), KROJAS, LFABIAN,
MVEGA. Los tres últimos pierden la pestaña.

## Dos capas, no una

**1. Servidor (la que manda).** Guardia nueva `_admin()` = ingeniería + flag.
Las **12 RPC** de la pestaña cambiaron su validación de `_ing` a `_admin`:

`fn_incentivos_quincena` · `fn_incentivos_tabla_listar` ·
`fn_bono_modular_listar` · `fn_bono_modular_guardar` ·
`fn_bono_modular_tabla_listar` · `fn_bono_modular_override` ·
`fn_ef_manual_listar` · `fn_ef_manual_guardar` · `fn_ef_tickets_rango` ·
`fn_consideracion_listar` · `fn_consideracion_guardar` ·
`fn_consideracion_eliminar`

Se comprobó que esas 12 no se usan en ninguna otra pantalla: sus 14 llamadas
viven todas en el bloque de incentivos de `ingenieria.js`.

**2. Vista.** `quitarIncentivos()` borra del DOM el ítem del menú y la sección
entera, y saca `pasoInc` de `NAV_TABS` para que el deep-link `#pasoInc` no la
abra. `activarTab` además rebota a Tickets si alguien la pide por código.

Lo importante: **la vista solo esconde**. Quien tenga el HTML viejo en caché, o
llame la RPC a mano, recibe `NO_AUTORIZADA` del servidor igual.

## Deslogueo general

Se invalidaron todas las sesiones vivas:

```sql
update operarios set token = null, token_expira = null, token_creado = null
 where token is not null;
```

La siguiente RPC de cada persona devuelve `SESION_INVALIDA`; con el parche 74 el
frontend avisa ("Tu sesión venció, vuelve a ingresar") y manda al login una sola
vez, sin la ráfaga de redirecciones que había antes. Lo ya registrado no se
pierde.

Hace falta porque `es_admin` viaja en la respuesta de `fn_login`: mientras no
vuelvan a entrar, la sesión guardada no trae el flag.

## Orden de despliegue (importa)

1. Push del frontend y **confirmar que Netlify ya sirvió la versión nueva**
   (es el que usa el personal).
2. Recién entonces el deslogueo.

Si se desloguea antes de que el deploy entre, los analistas vuelven a entrar
con el frontend viejo: verán la pestaña pintada, pero al cargarla les saltará
"No autorizada para esta acción". Feo, no roto.

**Ojo con ALOPEZ:** su sesión guardada tampoco trae el flag, así que ella
también tiene que volver a iniciar sesión para recuperar la pestaña.

## Cómo se comprobó

Contra producción (`lmlwomurgbbzolgbkwtp`), en transacciones con `rollback`:

- Las 12 funciones quedaron con `_admin` (12 de 12).
- `fn_incentivos_tabla_listar` con token de **ALOPEZ** → devuelve la tabla.
- La misma con token de **KROJAS** → `NO_AUTORIZADA`, levantada en `_admin`.
- `node --check` limpio en `app.js` e `ingenieria.js`.
