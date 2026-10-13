# PARCHE 124 — Velocidad de OFs de ACABADO

## El problema
Con la planta en marcha la base se pone lenta para todos. Medido en producción
(13-oct, últimas 24 h, edge logs):

| RPC | llamadas | p50 | p90 |
|---|---|---|---|
| fn_acabado_ofs (lista de OFs de ACABADO) | 236 | 2.2 s | 3.3 s |
| fn_ofs_area (OFs de costura) | 836 | 0.4 s | 2.6 s |

`fn_acabado_ofs` sola tardaba 2.5 s: por cada una de las 182 OFs buscaba otra
vez en `reclamos` la última vez que el operario la trabajó (~11 ms cada una,
2.1 s en total) y recorría la lista de operaciones tres veces por OF. Mientras
corre se come la CPU de la base y por eso las demás consultas (como
`fn_ofs_area`, que sola tarda 0.25 s) se van a 2-3 s en las horas pico.

## El cambio
- `fn_acabado_ofs`: la "última vez" sale de una sola pasada agrupada y las
  operaciones, prendas y colores se arman una vez para todas las OFs.
  Mismos parámetros y **misma respuesta** (md5 idéntico contra la versión
  anterior con datos reales de ACABADO). 2.5 s → 0.19 s.
- Índice parcial `reclamos_area_of_cod_activo (area, o_f)` para que
  `fn_ofs_area` cuente los paquetes tomados por OF sin leer cada fila.

No hay cambios en la app.

## Cómo verificar
```sql
select indexname from pg_indexes where indexname = 'reclamos_area_of_cod_activo';
select position('porof' in prosrc) > 0 as nueva from pg_proc where proname = 'fn_acabado_ofs';
```
Al día siguiente, en Supabase › Logs, `fn_acabado_ofs` debería estar bajo 0.5 s.

Rollback: `sql/parche_124_rollback.sql`.
