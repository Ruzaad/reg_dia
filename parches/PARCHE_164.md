# Parche 164 — Reporte de hoy › Trabajo en curso

**Problema:** Costos necesita ver, por área / prenda / OF (formato 4XXXXXXXXX) / módulo, la cantidad reportada de cada operación en el orden de la base. El reporte no traía el módulo.

**Cambio (base):** `fn_costos_en_curso(p_dni, p_token, p_fecha, p_area)`, lectura nueva sobre `reclamos`. `fn_costos_reporte_dia` no cambia.

**Cambio (app):** Reporte de hoy queda con dos pestañas: PENÚLTIMA OPERACIÓN (única regla para todas las áreas) y TRABAJO EN CURSO. Se quitó la descripción. La marca roja «Hoy» de los Gantt se calculaba sobre todo el ancho (incluida la columna de nombres) y ahora se alinea con los días. Cronogramas › Acabado: carga por semana en Minutaje o Prendas.

**Verificar:**
```sql
select fn_costos_en_curso('<dni>', '<token>'::uuid, current_date, '');
```
