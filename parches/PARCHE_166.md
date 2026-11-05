# Parche 166 — Bonificación con la estructura del mes

**Problema:** Incentivos › Quincena listaba a todo operario ACTIVO. El personal nuevo de CAMISA que entró en noviembre aparecía en la quincena 16-31 oct.

**Cambio:** `fn_incentivos_quincena` (misma firma) usa `estructura_mes` de los meses del rango. Entra quien está en la estructura vigente en el rango o tuvo actividad (tickets, incidencias, consideración, eficiencia manual). Si el mes no tiene estructura, sigue la regla anterior. Los días fuera del tramo desde–hasta salen `FUERA`: no penalizan ni cuentan en el promedio.

**Verificar:** Incentivos › Quincena 16/10–31/10, CAMISA: ya no sale LEON MERCADO, LEYDI STEFANY (estructura desde 03-nov).
