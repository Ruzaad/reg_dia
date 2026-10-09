# PARCHE 122 — Entrar a CORTE, REPROCESO y DESPACHO

## El problema
Nadie podía entrar a esas áreas: no están en `areas_config` (no tienen Sheet),
y la pantalla de elegir área solo mostraba costura y ACABADO.

## El cambio
- App (sin SQL): elegir área, cambiar área y el estajero muestran también
  CORTE, DESPACHO y REPROCESO ("Por lotes"). Al elegirlas se entra directo a
  los lotes.
- Base (`sql/parche_122.sql`): quien elige una de esas áreas al entrar trabaja
  ahí hoy aunque su supervisora no lo haya marcado EN <área>. Se guarda en
  `lote_area_elegida` (por día); no cambia su área en operarios.
  Sin el parche, CORTE y REPROCESO entran igual y quien está marcado EN <área>
  también; a los demás les sale que pidan que los marquen.
Rollback: `sql/parche_122_rollback.sql`.
