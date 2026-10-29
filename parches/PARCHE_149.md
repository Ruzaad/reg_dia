# Parche 149 — Inicio por áreas, entrada con DNI y fin de los estajeros

**Problema.** El Inicio de Ingeniería mezclaba toda la planta en un solo medidor (y usaba `fn_eficiencia_areas`, que tardaba ~14 s). Quien tenía área igual tenía que elegirla al entrar, y una persona INACTIVA no podía entrar.

**Cambio.**
- `fn_inicio_resumen(fecha)`: por área, personal, asistentes del día, prendas, minutos producidos (penúltima operación × S.A.M), tope (asistentes × jornada) y meta mínima (tope × 0,8). Mide ~0,4 s.
- `fn_inicio_mes(fecha)` + tabla `inicio_mes_cache`: acumulado del mes por área hasta el día anterior, guardado una vez al día (la primera consulta del día tarda ~4 s; las demás son instantáneas).
- Regla "EN <área>": cuenta en esa área solo si la persona registró tickets allí; si no, sigue en la suya. Corte, Despacho, UDP y Reproceso no exigen tickets.
- `fn_login`: quien entra con DNI y PIN correctos queda ACTIVO (y su asistencia de hoy, si figuraba ausente, pasa a ACTIVO). Los ESTAJERO ya no pueden entrar.
- Front: Inicio por áreas con filtro de fecha y Meta del mes; login entra directo al área (`area_actual`); se quitaron las pantallas del estajero.

**Verificar.** `select fn_inicio_resumen('<dni>', '<token>'::uuid, null);` devuelve `ok:true` con un arreglo `areas`.

**Deshacer.** `sql/parche_149_rollback.sql`.
