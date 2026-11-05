# Parche 167 — Bonificación › Cargar Bon. Corte

**Problema:** CORTE trabaja por tiempo y no tiene eficiencia por tickets; su bonificación se armaba a mano.

**Cambio (base):** `_bon_corte_aplicar` (interna) y `fn_bon_corte_cargar` (RPC, permiso de Incentivos con edición en CORTE). Para el personal de CORTE en días laborables y sin ausencia: la eficiencia de la tabla pegada o, sin tabla, el % del bono modular de CORTE de ese día. Si reclamó tickets en otra área, la eficiencia manual es solo lo que falta para llegar. Guarda en `eficiencia_manual`; el modular no pisa una eficiencia manual ya cargada. No crea tablas.

**Cambio (app):** Incentivos › Quincena, botón «Cargar Bon. Corte»: se pega la tabla de Excel (DNI, nombre, categoría, fecha, eficiencia) y usa el rango de la quincena.

**Verificar:**
```sql
select dni, fecha, pct from eficiencia_manual where fecha between '2026-10-16' and '2026-10-31' and registrado_por = 'CARGA BON. CORTE' order by 1, 2;
```
