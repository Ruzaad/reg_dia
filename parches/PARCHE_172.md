# Parche 172 — PCP: calendario mensual de metas

**Problema:** la vista de PCP era difícil de leer (colores y semáforos sin la forma habitual de un calendario).

**Cambio:** calendario Lun–Dom con M (meta), D (disponible), P (programado), R (real) y % con semáforo (≥95 verde, ≥70 ámbar, <70 rojo), conmutador Minutos | Prendas, resumen Mensual / A la fecha (meta × 0,85). La meta diaria se redistribuye: cada día hábil = lo que falta ÷ días hábiles restantes. Sábados/domingos trabajados se habilitan con un clic (tabla `dias_habilitados`); un día perdido (ej. lunes 16) se marca como feriado. `fn_pcp_meta_guardar` ya no borra la meta de prendas.

**Verificar:** PCP › calendario. Nov 2026 con 21 días hábiles (lunes 16 feriado, sábado 7 habilitado): día 2 = 1 800 000 ÷ 21 = 85 714; día 3 = (1 800 000 − 49 220) ÷ 20 = 87 539.

**Deshacer:** `sql/parche_172_rollback.sql`.
