# Parche 200 — Roles configurables (UDP) y PCP solo para Ingeniería

**Problema:** cualquiera con EDITAR en un área podía cargar programa/corte/cronograma y guardar metas en PCP; no había forma de crear roles con vistas limitadas (p. ej. UDP solo PCP).

**Cambio:** `_pcp_editor` exige cargo INGENIERIA (o Admin). Tabla pequeña `roles_sistema` (nombre + pestañas); `fn_roles_listar`, `fn_roles_guardar`, `fn_roles_eliminar` (Admin). Al dar el rol a alguien o guardar el rol, sus pestañas pasan a `permisos_pestana` (trigger `rol_trg`). UDP nace con `pasoPcp`.

**Verificar:** un usuario UDP solo ve PCP/Cronogramas y no ve la barra de cargas; `fn_pcp_programa_cargar` con ese usuario devuelve NO_AUTORIZADA.

**Deshacer:** `sql/parche_200_rollback.sql`.
