# Parche 182 — Bonificación del personal de apoyo sin ticket

**Problema:** quien apoya en DESPACHO, CORTE, ALMACEN, UDP o REPROCESO no reclama tickets esos días; el día salía sin eficiencia, contaba 0 en el promedio y bajaba su bonificación y su modular.
**Cambio:** `fn_incentivos_quincena` (misma firma). El día de apoyo (laborable, estado «EN …», sin consideración ni eficiencia manual) toma el promedio de eficiencia de sus días con ticket de la quincena; si no tuvo ninguno, el de los 31 días anteriores. Cada día trae `apoyo` (el área) para el informe. No toca tablas.
**Verificar:** 1–15 nov, ACABADO: 17 de 20 personas con apoyo; bono 242,58 → 296,20.
**Deshacer:** `sql/parche_182_rollback.sql`.
