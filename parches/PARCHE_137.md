# Parche 137 — Oficina operando como supervisora

**Problema:** VBENDITA (cargo COSTOS) abría «Operar como supervisora de REPROCESO» y la pantalla quedaba vacía: las RPC de supervisora (`fn_personal`, `fn_asistencia_marcar_lista`, `fn_solicitudes_listar`, `fn_retornos_pendientes`, `fn_sup_he_lista`, `fn_estados_asistencia_listar`) aceptan solo cargo SUPERVISORA o INGENIERIA y respondían NO_AUTORIZADA (visto en los logs del 19-oct).

**Cambio:** en una sesión prestada de tipo SUP, `_auth` devuelve a la persona como SUPERVISORA del área prestada (no cambia a INGENIERIA ni a administradores). Los permisos de escritura (`_perm_set`) se siguen calculando con su cargo real, así que solo escribe donde tiene EDITAR. El front (`prestadas.js`) guarda el cargo SUPERVISORA en esa sesión, así que sus solicitudes van por el flujo de la supervisora.

**Verificar:** entrar como VBENDITA › Operar como supervisora › REPROCESO: carga personal, asistencia y pedidos sin errores.
Rollback: `parche_137_rollback.sql`.
