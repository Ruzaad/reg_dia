# Parche 151 — Inicio solo con MOD y entrada bloqueada a quien no está en planta
**Problema.** El tope del Inicio contaba a todos los operarios activos (incluía MOI) y el parche 149 reactivaba a cualquier persona INACTIVA que entrara con su DNI.
**Cambio.** `fn_inicio_resumen` cuenta solo MOD de `estructura_mes` vigentes ese día, en el área de la estructura (la marca "EN <área>" del día sigue mandando). `fn_login` solo deja entrar a quien está ACTIVO y no tiene su estructura del mes cerrada; ya no reactiva a nadie.
**Verificar.** Un usuario INACTIVO recibe "DNI o clave incorrectos". En Inicio, Personal de cada área = MOD de la estructura.
**Deshacer.** `sql/parche_151_rollback.sql`.
