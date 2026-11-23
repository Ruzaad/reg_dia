# Parche 173 — PCP: calendario por área

**Problema:** el calendario de PCP era uno solo para toda la planta; la meta de prendas es distinta por área y línea.

**Cambio:** pestañas Planta · Camisa · Pantalón · Saco · Corte · Acabado · Reproceso. Disponible = MOD de la estructura del mes − vacaciones, licencias y DM de ese día. Programado: costura por área (programa de PCP) y corte (cronograma PDF). Meta de prendas: suma de CANT PROG del mes por área / OF que terminan de cortar en el mes. Meta de minutos: la del área, o la de la corporación repartida según su disponible. Planta en prendas = Camisa + Pantalón + Saco. Acabado y Reproceso solo con lo real.

**Verificar:** PCP › calendario, cambiar de pestaña. Nov 2026: Camisa 12 215 prendas de meta, Pantalón 10 240, Saco 2 827, Corte 16 716.

**Deshacer:** `sql/parche_173_rollback.sql`.
