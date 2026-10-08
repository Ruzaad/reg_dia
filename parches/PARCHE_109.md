# PARCHE 109 — Sesiones prestadas: "Entrar como" sin PIN y con registro

## El problema
"Entrar como operario" usaba `fn_login` con el PIN del operario. Eso le
cambiaba el token, así que su celular quedaba deslogueado ("Tu sesión
venció"), y en la base no quedaba quién había entrado. "Operar como
supervisora" registraba con el DNI del ingeniero, sin distinguirlo de lo que
hace desde Ingeniería. El permiso era solo el menú: la base no lo validaba.

## El cambio
- **Entrar como operario**: sin PIN. Se elige el motivo (olvidó el celular,
  sin batería, le ayudo a registrar, corregir un registro u otro). La base
  abre una sesión aparte que no toca la del operario.
- **Operar como supervisora**: también abre su sesión prestada, por área.
- **Quién puede**: el administrador, o quien tiene la pestaña Operar como ›
  Operario / Supervisora y Edición en esa área. Lo valida la base: KROJAS
  solo en SACO y PANTALÓN y LFABIAN solo en CAMISA.
- **Franja morada fija** "Operas como…", con borde en toda la pantalla, y el
  botón Volver a Ingeniería, que cierra la sesión. Reemplaza al 🏭.
- La sesión se cierra sola a los 60 min sin uso y como máximo a las 8 h.
- **Gestión › Sesiones prestadas**: quién entró, como quién, motivo, desde
  qué hora, estado, y qué registró (tickets, incidencias, cambios de área).
  "Cerrar ya" para quien la abrió o el administrador. Se reparte por área en
  Permisos.

## Base (`sql/parche_109.sql`)
- Tabla nueva `sesiones_prestadas`.
- Columna `prestada_id` en `reclamos`, `ocurrencias` y `movimientos_area`, puesta
  por un trigger al insertar.
- `_auth` solo cambia cuando el token no es el del operario. En ese caso busca
  una sesión prestada viva. El camino normal de todos queda igual.
- Nuevas: `fn_prestar_sesion`, `fn_prestada_cerrar`, `fn_sesiones_prestadas`,
  `fn_sesion_prestada_detalle`.
- Sin el parche, la app sigue como antes: el modal con PIN.

Rollback: `sql/parche_109_rollback.sql`. Devuelve `_auth` exactamente a la
versión de producción del 8-oct y quita triggers y funciones. La tabla y las
columnas se quedan, sin uso.
