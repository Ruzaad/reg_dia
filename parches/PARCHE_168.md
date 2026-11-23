# Parche 168 — CORTE con la eficiencia del bono modular

**Problema:** CORTE no tiene eficiencia por tickets; sin eficiencia manual salía NO ENTREGO y no ganaba.

**Cambio:** `fn_incentivos_quincena` (misma firma). En CORTE (operarios), el día laborable sin ausencia y sin eficiencia manual toma el % del bono modular de CORTE de ese día; si reclamó tickets, solo se suma lo que falta. Lo cargado con «Cargar Bon. Corte» o a mano manda. Sin modular ese día, igual que antes.

**Verificar:** Incentivos › Quincena 16/10–31/10, área CORTE: el 28/10 sale 60 % a quien no está en la tabla cargada.
