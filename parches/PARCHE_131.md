# Parche 131 — Bonificación: supervisoras por el bono modular

**Problema:** Bonificación (Incentivos › Quincena) y su Excel solo traían operarios; a las supervisoras de cada área se les pagaba el modular aparte, a mano.

**Cambio:**
- `fn_incentivos_quincena` (misma firma) incluye `cargo = 'SUPERVISORA'`. Para ellas:
  - Cada día laborable sin ausencia tiene un porcentaje fijo entre 70 y 79 (`hashtext(dni||fecha)`: el mismo cada vez que se consulta).
  - No ganan incentivo por categoría (soles del día = 0) y no tienen NO ENTREGO ni SIN MINUTOS.
  - Cobran el bono modular de su área (`area_actual`), que no depende de la categoría; pasa la puerta del 70% salvo que tengan días de ausencia que bajen el promedio. Falta o 3 tardanzas anulan igual que a un operario.
  - Salen con `categoria = 'SUPERVISORA'` y `supervisora = true`, al final de su área.
- Front: el Excel de Bonificación pone formato `0%` a las eficiencias de los días y a la columna % de la TABLA DE INC. (antes salían 0.84).

**Verificar:**
```sql
select count(*) from pg_proc where proname='fn_incentivos_quincena' and pg_get_functiondef(oid) like '%SUPERVISORA%'; -- 1
```
En la app: Incentivos › Quincena, las 5 supervisoras aparecen con Cat. SUPERVISORA y solo modular.

Rollback: `parche_131_rollback.sql` (vuelve la función exacta de producción del 16-oct).
