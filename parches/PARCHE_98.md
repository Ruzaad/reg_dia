# PARCHE 98 — "EN <área>" con tickets sí muestra eficiencia

Pedido de Ruzaad (6 oct 2026), ajuste del parche 97.

| Variable | Minutos exigidos | Eficiencia / incentivo / boleta |
|---|---|---|
| EN ACABADO, EN CAMISAS, EN SACOS, EN PANTALON | 575 + incidencias (igual que ACTIVO) | se calcula con sus tickets, como un día normal |
| EN DESPACHO, EN REPROCESO, EN ALMACEN, EN CORTE, EN SASTRERIA (UDP) | 0 | sin porcentaje, no se le exige boleta (como en el 97) |

En los tableros de asistencia las nueve siguen contando como presentes (parche 97).

Ojo: como en un día ACTIVO, si alguien queda "EN ACABADO" y no registra ningún
ticket, ese día sale NO ENTREGO en incentivos.

## Base (`sql/parche_98.sql`)

Solo cambia `_ausente(estado)`: ahora devuelve falso también para las cuatro
variables con tickets. Todas las funciones que la usan (eficiencia por día, rango
y áreas, auditoría, incentivos, Mi boleta, personal, avance, horas extras) pasan
a tratarlas como ACTIVO sin tocarlas una por una. Ninguna firma cambia.

Rollback: `sql/parche_98_rollback.sql`.

## Front

- Supervisora: las variables se separan en "Apoya en otra área con tickets · cuenta
  su eficiencia" y "Apoya en un área sin tickets · no se le exige". El aviso de
  "sus tickets no cuentan" solo sale para las de sin tickets.
- Personal de la supervisora: quien está EN ACABADO/CAMISAS/SACOS/PANTALON muestra
  sus minutos y entra en "Todo el personal" de incidencias.
- Ingeniería: los desplegables usan los mismos dos grupos.

## Cómo se comprobó

- Postgres local: `_ausente` da f para ACTIVO y EN ACABADO, t para EN DESPACHO,
  EN SASTRERIA (UDP) y VACACIONES; el rollback la deja como estaba.
- Producción (solo lectura): las 18 marcas EN CAMISAS son de dos operarios de
  ACABADO del 1 al 9 de octubre; en los días hábiles ya pasados tienen tickets,
  así que con este parche su eficiencia sale normal.
