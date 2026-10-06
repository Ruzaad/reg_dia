-- PARCHE 98 · "EN <área>" de producción sí tiene eficiencia
-- Ver parches/PARCHE_98.md. Requiere el parche 97. Idempotente.
-- EN ACABADO, EN CAMISAS, EN SACOS y EN PANTALON tienen tickets: se les exigen
-- los 575 min y su eficiencia se calcula como un día ACTIVO.
-- EN DESPACHO, EN REPROCESO, EN ALMACEN, EN CORTE y EN SASTRERIA (UDP) no tienen
-- tickets: siguen sin minutos exigidos (como hasta ahora).
-- `_ausente` la usan todas las funciones de eficiencia, incentivos, boleta,
-- personal y avance: cambiarla aquí cambia todas a la vez.

create or replace function public._ausente(p_estado text)
returns boolean language sql immutable
as $$ select coalesce(p_estado,'ACTIVO')
         not in ('ACTIVO','EN ACABADO','EN CAMISAS','EN SACOS','EN PANTALON') $$;

-- Verificación: debe dar f, f, t, t
-- select _ausente('ACTIVO'), _ausente('EN ACABADO'), _ausente('EN DESPACHO'), _ausente('VACACIONES');
