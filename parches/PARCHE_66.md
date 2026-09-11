# PARCHE 66 — Repara timeouts reales (fn_asignar_tickets + 3 más)

## Disparador
El usuario reportó timeout al usar "asignar tickets" en ingeniería. Antes de
tocar nada se revisaron los logs de las últimas horas para encontrar TODOS
los casos reales, no solo el reportado.

## Encontrado en logs (evidencia, no suposición)
| Función | Fallos vistos | Causa |
|---|---|---|
| `fn_asignar_tickets` | 2× ~3.2-3.4s (500) | Recalculaba `fn_tickets_of_raw(area, null)` — el área ENTERA — solo para filtrar los pocos códigos a asignar. |
| `fn_tickets_libres` | 0 aún, mismo bug | Si se busca "libres" sin OF ni artículo (uso normal en ingeniería), hacía la misma recomputación completa. |
| `fn_liberar_ids` | 2× ~3.2-3.4s (500) | Libera tickets en loop, uno por uno (vía `_deshacer_troceo`); con un lote grande (content-length 5352 vs ~250 de los que sí pasan) la suma de todas las vueltas cruza el límite. |
| `fn_tickets_area` | 4× ~3.7-3.9s (500) | **No es un bug de SQL.** Ya lee de `tickets_cache` (~60ms de cómputo), pero el JSON de salida pesa 7-15MB según el área — eso es lo que tarda en viajar por red. Confirma que hace falta la carga por-OF que se está diseñando (el "punto 1" de la conversación anterior). |
| `fn_reclamar` | 1× aislado, 504 (7.3s) | Su lógica ya es liviana e indexada; no se tocó. Probablemente colateral de tener `fn_tickets_area` corriendo en paralelo. Queda en observación, no en este parche. |

## Fix aplicado
1. **`fn_asignar_tickets`**: la fuente del loop pasa de
   `fn_tickets_of_raw(p_area, null)` a `tickets_cache` filtrado por área y
   códigos — mismo resultado, de un cálculo completo a una búsqueda
   indexada. Medido: **5.3ms** (antes 2.8-4.5s+).
2. **`fn_tickets_libres`**: mismo cambio de fuente (`tickets_cache` en vez de
   recomputar). Peor caso medido (sin OF ni artículo, área más grande):
   **1.68s** — dentro del margen de los 30s que ya tenía.
3. **`fn_liberar_ids`**: se le agregó `SET statement_timeout TO '30s'` como
   colchón. No se reescribió el loop interno (llama a `_deshacer_troceo`,
   que tiene lógica condicional por ticket — más riesgoso de tocar sin más
   evidencia). Si lotes grandes lo siguen llevando al límite, el siguiente
   paso sería una reescritura *set-based*.
4. Se eliminó el overload huérfano `fn_tickets_cache_refrescar(text)` (un
   solo argumento) que quedó del parche 65 — `CREATE OR REPLACE` con un
   parámetro nuevo no reemplaza la firma vieja, crea una aparte. Era
   ambigua para quien la llamara con un solo argumento y podía terminar
   ejecutando la versión lenta original sin que nadie lo notara.

## Verificación
- `tickets_cache` filtrado por área+códigos (la consulta que ahora usa
  `fn_asignar_tickets`): 5.3ms medido con `EXPLAIN ANALYZE`.
- CTE de "libres" sin filtro de OF (peor caso de `fn_tickets_libres`, área
  CAMISA COSTURA): 1.68s medido.
- Confirmado que solo queda una firma de `fn_tickets_cache_refrescar`
  (`p_area text, p_of text`).

## Riesgo / rollback
Mismo patrón aditivo de siempre — no se borró lógica de negocio, solo se
cambió la FUENTE de los datos (de recomputar a leer la cache ya mantenida
por los parches 62/65). Si algo no cuadra, comparar contra
`fn_tickets_of_raw(area, null)` debería dar el mismo resultado (la cache es
un espejo exacto de esa función).

## Pendiente (no resuelto aquí)
- `fn_tickets_area` sigue mandando 7-15MB de JSON — el statement_timeout no
  ayuda porque el cuello de botella es la transferencia, no el cómputo.
  Está en diseño la carga por-OF (punto 1) que lo resuelve de raíz.
- `fn_liberar_ids` con lotes muy grandes podría necesitar reescritura
  set-based si 30s no alcanza en el futuro.
