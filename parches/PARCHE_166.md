# PARCHE 166 — Optimización: Inicio de Ingeniería más liviano (Boletas sin llenar y producción del día)

Hilo maestro "Optimización" (4-nov-2026). Todo se midió en producción en modo solo lectura. **Ninguna RPC cambia de nombre, parámetros ni respuesta.**

## Problema (medido el 4-nov)

`fn_boletas_sin_llenar` tenía p50 1,5 s y p90 3,8 s, pero sola tarda ~0,4 s. Los picos coinciden siempre con la carga del **Inicio de Ingeniería**, que lanza 9 consultas a la vez (y se refresca cada 10 min): resumen del día, meta del mes, boletas, días no laborables, asistencia, auditoría, solicitudes y plan. Con todas compitiendo por el mismo procesador, cada una tarda varias veces más. Las dos que más trabajo repetían:

| Qué | Antes |
|---|---|
| `_pcp_prod` (producción en minutos y prendas; la usan Inicio, Meta del mes y PCP) | 333 ms para **un solo día**: en cada llamada calculaba `_nk()` sobre las ~25 mil filas de `bases` (266 ms), aunque ese día solo se produjeran 3 artículos |
| `_boleta_estados` (Boletas sin llenar) | recorría dos veces los ~68 mil reclamos de los últimos 21 días, y "desde cuándo existe" leía toda la asistencia de cada persona |

## Cambio

- **A. `_boleta_estados`**: un solo recorrido de reclamos del rango (agrupado por persona, día y área) alimenta "entregó" y "el área trabajó ese día". La primera asistencia de cada persona se busca por índice.
- **B. `_pcp_prod`**: el minutaje de la base (`sum(std)`) se calcula solo para los artículos producidos en el rango, por el índice `bases_area_art_nop_idx`/`bases_area_art_op_idx` que ya existía.

## Comprobado (en producción, solo lectura)

- `_pcp_prod`: 0 diferencias en un día (3-nov), octubre completo y 1-jul → 4-nov (312 filas). Un día pasa de 333 ms a 52 ms; octubre completo de 1,03 s a 0,60 s.
- `_boleta_estados`: 0 diferencias en tres ventanas de 21 días (15-oct → 4-nov, 20-sep → 10-oct y agosto), 3 360 filas cada una. Pasa de ~390 ms a ~230 ms con todo el personal.
- En Postgres 16 local: el parche corre, el deshacer vuelve las dos funciones a su versión anterior y el parche se puede volver a correr.

## Cómo correrlo

Se pega `sql/parche_166.sql` entero en el SQL Editor. No bloquea nada, se puede correr en cualquier momento.

## Cómo verificar

```sql
select count(*) from parche_166_respaldo;                       -- 2
select prosrc like '%_nk(b.articulo) = v.k%' from pg_proc where proname = '_pcp_prod';   -- true
```

## Deshacer

`sql/parche_166_rollback.sql` vuelve a ejecutar las definiciones guardadas en `parche_166_respaldo` y borra esa tabla.
