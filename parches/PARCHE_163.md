# PARCHE 163 — Optimización: lista de OFs del operario, limpieza, bitácora, sueltos, boletas, días no laborables y bases

Hilo maestro "Optimización" (3-nov-2026). Todo se midió en producción en modo solo lectura. **Ninguna RPC cambia de nombre, parámetros ni respuesta**, así que Netlify y GitHub Pages siguen funcionando igual.

## Problema (medido el 3-nov)

| Qué | Antes |
|---|---|
| `fn_ofs_area` (lista de OFs del celular del operario) | 343 llamadas al día, p50 0,8 s y p90 5,6 s. Contaba ~95 mil tickets y ~89 mil reclamos en cada llamada |
| `reclamos` | 35 mil filas muertas. Un recorrido de índice tenía que ir a la tabla 168 mil veces |
| `tickets_cambios_det` | 19 MB para 11 600 filas: cada cambio guardaba la fila entera de reclamos dos veces (~1,4 KB) |
| `fn_paquetes_sueltos` | 7 de 14 llamadas con error 500 (corte de 3 s). `_sueltos` tardaba 6,3 s solo con CAMISA |
| `fn_boletas_sin_llenar` | p50 3,3 s. "Desde cuándo existe" recorría ~225 mil reclamos |
| `fn_dias_no_laborables` | p50 3,5 s. Recorría todos los reclamos activos para quedarse con unos pocos días |
| Editar bases (`fn_base_ops_editar_lote`, hasta 18 s) | Borraba y volvía a insertar todos los tickets de cada OF del artículo, y reescribía todos sus reclamos aunque no cambiaran |

## Cambio

- **A. `of_area_conteo`**: es una tabla nueva con una fila por área y OF (`total` de tickets y `reclamados` activos). La mantienen seis triggers por sentencia sobre `tickets_cache` y `reclamos`, y solo tocan la fila cuando el conteo cambia de verdad. `fn_ofs_area` ahora lee esa tabla. La función `_oac_recalcular()` la rehace desde cero si alguna vez hay dudas.
- **B. Limpieza automática** (autovacuum) al 2 % en lugar del 20 % en `reclamos` y `tickets_cache`.
- **C. `_tickets_cambio_trg`**: de reclamos guarda solo las 14 columnas que leen el deshacer, el detalle del cambio y la ficha del paquete (función `_tc_ficha`). Cada fila nueva pesa la mitad. Lo ya guardado no se toca (ver "Opcional").
- **D. `_sueltos`**: es la misma consulta, pero armada con los valores reales (`EXECUTE`), filtrada por área también en `tickets_cache` y con `work_mem` de 16 MB. ACABADO sigue fuera.
- **E. `_boleta_estados`**: el primer reclamo de cada persona se busca por índice y el día con ausencias justificadas usa `_jornada` en vez de 575. En `fn_boletas_sin_llenar`, los últimos 11 días laborables se arman en una sola pasada.
- **F. `fn_dias_no_laborables`**: reclamos y ocurrencias se buscan por índice solo en los días no laborables.
- **G. `fn_tickets_cache_refrescar`**: borra solo los tickets que ya no van, inserta los nuevos y actualiza los que cambiaron. `actualizado` conserva la fecha en que se generó el ticket, así que una edición de base ya no hace que una OF vieja parezca recién generada en Carga vs capacidad. `_sync_reclamos_articulo` solo escribe los reclamos cuya ruta cambió. Se agrega un índice chico para los ~280 reclamos históricos sin `op_id`.
- **Front (ingenieria.js)**: después de editar, crear o eliminar una operación de la base ya no se reescribe el ALMACÉN del Sheet (edge function `generar-tickets`, acción `actualizar`) ni se repite `fn_base_sync`, porque esas RPC ya sincronizan reclamos por dentro. Tras subir un Excel se sigue llamando a `fn_base_sync`, pero sin tocar el Sheet. No se borra ningún dato del Sheet ni la edge function.

## Comprobado

- En una copia de producción (solo lectura), las versiones nuevas devuelven **exactamente lo mismo** que las actuales: `_boleta_estados` (3 339 filas, 0 diferencias), los 11 días de los 42 pendientes de ayer (0 diferencias) y `_sueltos` de PANTALÓN (3 994 filas, 0 diferencias).
- Tiempos en producción: `_sueltos` de CAMISA pasó de 6,3 s a ~1,4 s, la parte de reclamos de días no laborables de 408 ms a 10 ms y "desde cuándo existe" de recorrer 225 mil filas a 159 búsquedas por índice.
- En Postgres 16 local, con inserciones, anulaciones, cambios de OF, borrados y regeneración parcial y total de tickets, `fn_ofs_area` dio lo mismo que la consulta anterior y el conteo por triggers coincidió con `_oac_recalcular()`. `tickets_cache` quedó igual a lo que genera `fn_tickets_of_raw`, una segunda sincronización de la misma base escribe 0 reclamos y el deshacer revierte las 8 funciones a su versión anterior.

## Cómo correrlo

1. **Fuera de hora punta**: la carga inicial del conteo bloquea los registros nuevos unos 4 s. Esos registros esperan, no se pierden. Se pega `sql/parche_163.sql` entero en el SQL Editor.
2. Aparte, en otra consulta, se corre `vacuum (analyze) reclamos; vacuum (analyze) tickets_cache;`.

## Cómo verificar

```sql
-- 1) Conteo igual al recálculo (debe dar 0 y 0)
with a as (select area,o_f,articulo,total,reclamados from of_area_conteo)
select (select count(*) from (select area,o_f,max(articulo),count(*) from tickets_cache group by 1,2
          except select area,o_f,articulo,total from a) x) dif_tickets,
       (select count(*) from (select area,o_f,count(*) from reclamos where estado='ACTIVO' and codigo is not null and o_f is not null group by 1,2
          except select area,o_f,reclamados from a) y) dif_reclamos;
-- 2) Funciones nuevas
select count(*) from pg_trigger where tgname like 'oac_%';   -- 6
```

## Deshacer

`sql/parche_163_rollback.sql` vuelve a ejecutar las definiciones guardadas en `parche_163_respaldo` y quita la tabla, los triggers, el índice y los ajustes de limpieza.

## Opcional: compactar la bitácora ya guardada

Para recuperar unos 9 MB de `tickets_cambios_det` hay que recortar las filas viejas con `_tc_ficha` y luego correr `vacuum full tickets_cambios_det` (bloquea esa tabla unos segundos). Las columnas que se descartan (std, nop, módulo, color, talla, etc. de la foto del reclamo) no las lee ninguna función. No va dentro del parche porque cambia datos ya guardados; el SQL está en la carpeta del hilo.

## Revisión de `fn_of_trazabilidad` (sin cambios en este parche)

Ya no existe una "v2": fue un paso intermedio del parche 68 y la función vigente es la que salió de él. Tarda entre 3,5 y 11,5 s porque une **todos** los reclamos activos (~225 mil) con `ofs` mediante `_nk(r.o_f) = _nk(f.o_f)`, una función aplicada a cada fila que impide usar índices, y recién después filtra por el periodo. Para que sea inmediata hacen falta tres cosas:

1. Una tabla resumen por OF (primera y última fecha, unidades por módulo y operación) mantenida por triggers, como `of_area_conteo`.
2. Normalizar `reclamos.o_f` una sola vez, o crear un índice sobre `_nk(o_f)`, para no aplicar `_nk` en cada consulta.
3. Traer el detalle solo de las OF del periodo.

Se haría en un parche aparte, con la misma comprobación de "misma respuesta".
