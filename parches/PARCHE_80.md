# PARCHE 80 — Auditoría de eficiencia (solo ALOPEZ)

## Por qué existe

Un operario no debería pasar de ~90%. Si pasa, o su tiempo está mal tomado, o
está reclamando tickets de más. El mecanismo que lo infla es este:

```
eficiencia = producido / (575 + minutos de incidencias) × 100
```

Casi toda incidencia trae minutos **negativos** (ARREGLOS, MUESTRAS, MAQUINA,
REPROCESOS… promedian entre −69 y −186). Al restar del denominador, **suben** el
porcentaje. Solo HORA_EXTRA suma.

El caso real más extremo de los últimos 30 días lo dice todo:

> **HUAMAN ROJAS, MAGALY** · 2026-09-14 · PANTALON COSTURA
> Produjo **575 min** en **68 tickets**. Tiene **una incidencia de −290 min**
> ("APOYANDO A MILAGROS Y PROBLEMAS CON FORRO…"), así que su disponible quedó en
> 285 y su eficiencia en **201.8%**.
> Sin esa incidencia sería **100%** — que sigue siendo el tope exacto.

## La pantalla

Entrada nueva **Eficiencia → Auditoría**, del administrador maestro.

Filtros: **área**, **desde/hasta** y **umbral** (editable, arranca en 90), más
buscador y un check "solo con incidencia".

El umbral es configurable porque el volumen cambia mucho con él. Medido contra
producción, últimos 30 días, **2065 días-persona evaluados**:

| Umbral | Días marcados |
|---|---|
| 90% | 471 (23%) |
| 110% | 57 |

La tabla reusa lo que ya existe en el proyecto: cabeceras ordenables
(`ordThead`/`ordAplicar`), buscador, paginado de 50, descarga a XLSX y la barra
de porcentaje de Resumen de OF. Sobre 100% va en rojo, sobre el umbral en ocre.

Columna **"Sin incidencia"**: a cuánto caería ese día si se le quitaran todas
las incidencias. Es el atajo para ver de un vistazo cuánto del exceso lo explica
la incidencia y cuánto no.

## El panel de la persona

Al tocar una fila se abre un panel lateral con la forma de la referencia:
cabecera con iniciales, nombre y día; tres KPI (Eficiencia, Producido,
Disponible); el detalle del día; **las incidencias**; y **los tickets**.

Cada incidencia trae su simulador:

- **Minutos corregidos** — se escriben y el cuadro de arriba recalcula en vivo
  a qué eficiencia llegaría.
- **Quitar / Devolver** — simula que esa incidencia no existe.
- **Guardar minutos** / **Eliminar incidencia** — aplica el cambio de verdad,
  con un `confirm` que dice explícitamente de qué % a qué % se pasa.

**La simulación nunca toca lo producido.** Solo mueve el denominador: los
tickets no se editan desde aquí.

Aplicar reutiliza `fn_ocurrencia_editar` y `fn_ocurrencia_eliminar`, que ya
existían en la pantalla de Incidencias — **no se creó ninguna RPC de escritura
nueva**. Tras aplicar, el panel y la tabla se refrescan solos.

El panel también muestra la **eficiencia manual** del día si la hay. En el caso
de HUAMAN ROJAS ya había un `−123` cargado a mano: alguien ya había notado el
problema y lo estaba corrigiendo por fuera. Esta pantalla es para no depender de
que alguien lo note.

## Permisos

`fn_ef_auditoria` y `fn_ef_auditoria_detalle` validan con `_admin` (parche 78),
así que la protección es de servidor, no de vista: `pasoAudit` se suma a
`TABS_ADMIN` y se borra del DOM para quien no sea maestro, pero aunque alguien
llame la RPC a mano recibe `NO_AUTORIZADA`.

## Cómo se comprobó

**Servidor**, contra producción en transacciones con `rollback`:

- Umbral 90 → 471 marcados de 2065 evaluados; umbral 110 → 57. Filtro por área
  ACABADO → 57. Rango invertido → el error esperado.
- El detalle del caso HUAMAN ROJAS devuelve sus 68 tickets, su incidencia de
  −290 y la eficiencia manual de −123.
- `fn_ef_auditoria` con token de KROJAS → `NO_AUTORIZADA`.

**Matemática de la simulación**, 19 pruebas en Node sobre las funciones reales
extraídas del archivo, incluyendo el caso real de producción:

- Sin tocar nada: 285 min disponibles → 201.8%.
- Quitando la incidencia: 575 → **100%**.
- Corrigiendo −290 a −60: 515 → 111.7%.
- Con dos incidencias, quitar una sola descuenta solo esa.
- HORA_EXTRA (suma): quitarla **sube** la eficiencia (86.3% → 104.3%).
- Disponible 0 o negativo (incidencia que se come el turno entero): no se
  divide, se dice "sin tiempo disponible".
- Semáforo del umbral e iniciales del avatar.

Falta probarlo en el equipo: abrir el panel y aplicar un cambio real.

## Lo que NO entra en este parche

El control de permisos por **pestaña + área con niveles ver/editar** que pediste
en el mismo mensaje. Es un modelo distinto al flag de hoy y toca la validación
de muchas RPC de escritura; va en su propio parche para no mezclarlo con esto.
