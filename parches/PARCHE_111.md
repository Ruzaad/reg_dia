# PARCHE 111 — Asistencia por confirmar

## El problema
La mitad de las áreas nunca marca asistencia en la app: Ingeniería la carga en
lote al cierre de la quincena, y entre carga y carga esas áreas quedan en
blanco. Quien no tiene ticket ni estado recibe 575 minutos exigidos y en
Incentivos su día sale NO ENTREGÓ, que anula la quincena.

## El cambio
- **Supervisora (sin SQL):** la pestaña Asistencia abre en **Ayer** con solo
  quien no registró tickets ni tiene estado. Botones grandes Vino, Faltó, DM,
  Vacaciones (con "hasta": marca todos los días hábiles de una vez) y Otro.
  Las áreas sin tickets (CORTE, REPROCESO, UDP) tienen "Vinieron los N" de un
  toque. "Hoy" sigue siendo la lista de siempre. Usa las RPC que ya existen.
- **Ingeniería › Tickets › Asistencia por confirmar:** por área y por cada uno
  de los últimos 10 días hábiles, cuántos faltan confirmar y quién viene
  marcando. "Confirmar N" abre la lista del último día para marcarla desde ahí.
  Sale para quien ya ve Boletas sin llenar.

### Base (`sql/parche_111.sql`)
`fn_asistencia_por_confirmar(dni, token, desde, hasta)`: solo lectura, máximo
31 días, respeta las áreas de Permisos. No crea tablas ni cambia cálculos.
Rollback: `sql/parche_111_rollback.sql`.

Sin el parche, la pantalla de Ingeniería avisa que falta; lo de la supervisora
funciona igual.
