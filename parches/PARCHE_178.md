# Parche 178 — PCP: cronograma de costura

**Problema.** El calendario de PCP no servía para dar seguimiento: faltaba ver lo programado por OF, el avance real y qué falla.

**Cambio.**
- `fn_pcp_costura(mes)` (lectura): filas del programa de costura agrupadas por semana de INI COSTURA con las 16 columnas pedidas.
  - **STD** = suma de la base del artículo (si el artículo tiene varias prendas, la de la fila). Sin base, queda vacío y avisa.
  - **MIN X DIA** = personas de la línea × 9,57 h × 60. La línea es el grupo de su supervisora (ANA, DORIS, MARIAELENA): sus personas son los MOD del área en la estructura del mes. Los talleres no tienen estructura → avisa.
  - **DÍAS HÁBILES** = CANT PROG × STD ÷ MIN X DIA.
  - **STATUS** = lo reclamado en la penúltima operación de la OF ÷ CANT PROG. Verde 80–100, amarillo 51–79, rojo 0–50. Sin dato mientras la OF no arranca.
  - **OBSERVACIÓN**: lista específica de alertas (sin OF, artículo no registrado, sin base, STD no encontrado, OF no creada, secuencia, estructura, sin producción, etc.).
- `pcp_programa`: columnas `target` y `operarios`; `fn_pcp_programa_cargar` las guarda (hay que volver a subir el Excel para llenarlas).
- `fn_reclamar` / `fn_reclamar_lote`: en COSTURA no dejan reclamar un artículo sin base de operaciones. Al 13-nov hay 0 reclamos de costura sin base desde octubre, así que no cambia lo que hoy se hace.

**Cómo verificar.** PCP · Meta y programa: aparece el cronograma por semanas. Reclamar un paquete de un artículo sin base debe mostrar «no tiene base de operaciones».

# Parche 179 — retira el calendario

`drop` de `fn_pcp_calendario`, `fn_pcp_calendario_areas`, `fn_pcp_dia_cambiar` y `_habil`. No toca `dias_habilitados` ni `metas_mes`. Correr después del deploy del front nuevo.
