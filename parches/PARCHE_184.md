# Parche 184 — Reconocimiento por quincena

**Problema:** no hay forma de reconocer a quienes llenan sus boletas y rinden más de 80 %, ni de que el operario lo vea.
**Cambio:** tabla `reconocimientos` (≈ 60 filas al mes) y 3 funciones: `fn_reconocimiento_publicar` y `fn_reconocimientos` (Ingeniería, pestaña Incentivos) y `fn_mi_reconocimiento` (el operario). El top 5 por área sale de `fn_incentivos_quincena`, sin fórmulas nuevas.
**Verificar:** Ingeniería › Reconocimientos › Publicar; en la cuenta del operario premiado aparece la tarjeta.
**Deshacer:** `sql/parche_184_rollback.sql` (borra las 3 funciones y la tabla).
