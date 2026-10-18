# PARCHE 133 — Personal: estructura por mes

**Problema:** el Excel de estructura se arma a mano a inicio de mes (MOD/MOI, cargo, área) y no refleja ingresos, bajas ni quién apoya en otra área. Los cálculos por área se hacen sobre el personal "real", sin una estructura oficial.

**Cambio:**
- Tabla `estructura_mes` (mes, dni, nombre, área, subárea, tipo MOD/MOI, cargo, ingreso, baja, observación), con el mismo control de permisos por área. Admite personal sin usuario en el sistema (liquidación, tizadores, jefes).
- Trigger en `operarios`: un ingreso nuevo entra a la estructura del mes con su fecha; pasar a INACTIVO pone la fecha de baja y reactivar la quita. Solo toca el mes en curso. Ninguna RPC existente cambia.
- `fn_estructura_mes` (lectura, con lo que hoy está en `operarios` y los movimientos de área del mes), `fn_estructura_guardar`, `fn_estructura_quitar`, `fn_estructura_copiar` (trae del mes anterior a quien sigue).
- Se carga la estructura de octubre 2026 desde el Excel de inicio de mes, más quienes están activos y no venían en el Excel (ingresaron después), y se marca la baja de quienes venían y hoy están inactivos.
- Front: pestaña ESTRUCTURA en Personal (mes, altas, bajas, apoyo en otra área, editar, copiar del mes anterior) y botón DESCARGAR EXCEL (hoja ESTRUCTURA con el formato de siempre, ALTAS Y BAJAS, APOYO EN OTRA ÁREA).

**Pendiente (siguiente paso):** que bonificación, costos y carga vs capacidad lean la estructura del mes como base.

**Verificar:**
```sql
select count(*), count(*) filter (where hasta is not null) bajas, count(*) filter (where desde is not null) ingresos
from estructura_mes where mes = '2026-10-01';
```
Debe dar 174 personas (171 del Excel + 3 que ingresaron después... el número exacto depende de los activos de ese día), 2 con baja.

**Deshacer:** `sql/parche_133_rollback.sql` (borra la tabla y su contenido).
