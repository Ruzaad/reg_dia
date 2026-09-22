# PARCHE 81 — Limpieza de la base: permisos, índices e higiene de tickets_cache

**Estado: sin aplicar.** Nada de esto está en producción.

## Por qué existe

Un barrido de la base (22-set-2026) encontró que el 88 % del peso está en tres
tablas que el sistema usa a diario, que no hay datos históricos que purgar y que
ninguna tabla está sin uso. El espacio no es el problema. Lo que sí apareció:

1. Tres funciones internas quedaron ejecutables por el rol `anon`, **sin pedir
   DNI ni token**, desde que el parche 62 las creó. Una de ellas borra el
   almacén de tickets de un área entera.
2. `fn_tickets_area` se llevó el **46 % de todo el tiempo de CPU de la base**
   desde julio (4 h 22 min) y dejó de llamarse el 15 de setiembre.
3. Dos índices que ya no aportan, y `tickets_cache` arrastrando la basura de
   817 000 borrados.

## A1 — Los tres internos dejan de ser alcanzables desde afuera

| Función | Qué hace |
|---|---|
| `fn_tickets_cache_refrescar(area, of)` | `delete from tickets_cache where area = p_area` y vuelve a llenar |
| `fn_tickets_cache_refrescar_articulo(area, articulo)` | Lo mismo, por artículo |
| `fn_tickets_of_raw(area, of)` | Devuelve los tickets crudos de una OF |

Las tres son `SECURITY DEFINER` y no validan sesión. La clave `anon` viaja
dentro de la PWA, así que cualquiera que abra el código de la página puede
llamarlas. Llamada con un área y sin OF, la primera deja esa área sin tickets
en plena jornada.

**Evidencia de que no se rompe nada:** cero llamadas por REST en 74 días
(`pg_stat_statements` desde el 10-jul, con `dealloc = 0`: no descartó ninguna
entrada, así que el cero es real y no un hueco de estadística). Por dentro las
llaman 8, 3 y 2 funciones respectivamente, y las llamadas entre funciones no
pasan por este permiso.

**No se borra ninguna función. Solo el `EXECUTE` de `anon` y `authenticated`.**

## B1 — Baja de `fn_tickets_area`

La reemplazó `fn_tickets_of` en el parche 67, después del incidente del viernes
11 de setiembre ("Failed to fetch" en el cambio de turno). Los logs de ese día
lo confirman: **25 respuestas con error 500** solo en esa función.

Devolvía el catálogo completo de un área en un único JSON de 7 a 15 MB, a 2.6 s
por llamada.

| Fecha | Llamadas/día |
|---|---:|
| 1 al 12 de setiembre | 400 a 500 |
| 13 de setiembre | 7 · aparecen `fn_ofs_area` y `fn_tickets_of` |
| 14 de setiembre | 26 |
| **15 al 22 de setiembre** | **0** |

**Por qué el cero es concluyente:** los tres despliegues (Netlify, Vercel,
GitHub Pages) apuntan a esta misma base, así que los logs de Supabase los ven a
los tres a la vez. Ocho días sin una sola llamada significa que ninguno de los
tres la llama, no solo el que está al día.

**Por qué no hay riesgo de una PWA vieja en caché:** el service worker
(`sw.js`) es *network-first* — `fetch(e.request).catch(() => caches.match(...))`.
Va siempre a la red y solo tira de caché si no hay señal. Un celular con la app
vieja toma el `app.js` nuevo apenas tiene internet. Además solo cachea GET: las
RPC son POST y pasan de largo.

Ninguna otra función la llama.

**Si prefieres un paso reversible:** el `.sql` trae comentada la alternativa de
quitarle el `EXECUTE` en vez de borrarla. Se deshace en segundos con un `grant`.

## A2 y A3 — Dos índices que ya no aportan

| Índice | Tamaño | Por qué se va |
|---|---:|---|
| `reclamos_motivo_fecha_idx` | 112 kB | **Cero usos desde el 30-jun.** El linter de Supabase también lo marca. Se paga en cada `update` de `reclamos`, y van 1.25 millones. |
| `tickets_cache_area_idx` | 2.4 MB | Lo creó el parche 62. El parche 67 añadió `tickets_cache_area_of_idx (area, o_f, n_op, paq)`, que lo cubre por prefijo, y nadie retiró el viejo. Se paga en las 850 000 inserciones del refresco. |

## A4 — Higiene de `tickets_cache`

### Qué es esta tabla

No es un dato maestro: es una **copia derivada**. Antes del parche 62,
`fn_tickets_of_raw` recalculaba todo el catálogo de tickets del área en cada
llamada (37 531 filas para CAMISA COSTURA, ~2.8 s solo de cómputo). El parche 62
congeló ese resultado en una tabla y desde entonces solo se recalcula cuando
ingeniería cambia algo que afecta al catálogo.

Se puede reconstruir entera en cualquier momento a partir de `bases`,
`of_troceo` y `of_generada`.

### Quién la reescribe, y cuándo

| Función | La llaman |
|---|---|
| `fn_tickets_cache_refrescar` | `fn_of_generar`, `fn_of_registrar` |
| `fn_tickets_cache_refrescar_articulo` | 7 funciones que editan bases (`fn_base_op_editar`, `fn_bases_subir`, …) |

Las dos hacen `delete` de todas las filas del área y las vuelven a insertar. O
sea: **borrar en `tickets_cache` ya ocurre en plena jornada, por diseño**, cada
vez que ingeniería toca una base o genera una OF. De ahí salen las 850 619
inserciones y 816 970 borradas desde julio.

### Por qué el REINDEX no interfiere

Esta es la parte importante de tu pregunta: **`REINDEX` no borra ni una fila.**
Reescribe los archivos de índice a partir de las filas que ya están. Con
`CONCURRENTLY` tampoco toma bloqueo exclusivo: lecturas y escrituras siguen
funcionando de principio a fin.

Lo que sí cuesta:

- Tarda más que un reindex normal.
- Usa disco extra mientras construye la copia nueva.
- Compite por I/O con el resto de la base.
- Si falla a medias deja un índice inválido, que hay que borrar antes de
  reintentar (el `.sql` trae la consulta para encontrarlo).

**Por eso conviene correrlo fuera de turno**, no porque bloquee, sino por el I/O
y porque `tickets_cache` es justo la tabla que lee la pantalla del operario. La
ganancia (~10 MB estimados) no es urgente: no hay nada en riesgo si se hace la
semana que viene.

Hoy la tabla arrastra ~28 700 filas muertas y 26 MB de índices para 146 000
filas, cuando lo esperable serían ~16 MB.

## Cómo se aplica

**En dos partes. La parte 2 no corre dentro de una transacción.**

1. **Parte 1** (A1 + B1), en cualquier momento. Va dentro de `begin … commit`.
2. **Parte 2** (A2, A3, A4), fuera de turno, **cada sentencia por separado**.
   `DROP INDEX CONCURRENTLY` y `REINDEX CONCURRENTLY` fallan si los metes en una
   transacción.

Al final del `.sql` están las consultas de comprobación.

## Qué NO entra en este parche

- **Ninguna fila de ninguna tabla.** `reclamos` arranca el 11-jul-2026 y
  `tickets_cache` no guarda ninguna OF con más de 30 días sin movimiento: no hay
  historia que purgar.
- **Ninguna tabla ni columna.** La columna `tickets_cache.actualizado` (parche
  62, línea 13) no la lee ninguna de las 137 funciones, pero se queda: cuesta
  ~1.1 MB y es el único rastro de cuándo se escribió una fila de la cache.
- **Las sobrecargas viejas** de `fn_acabado_registrar`, `fn_base_op_eliminar`,
  `fn_movimiento_hora`, `fn_personal_crear` y `fn_personal_editar`: todas
  **siguen recibiendo llamadas**. Ver el informe del 22-set.
- **`fn_asistencia_mes`**: 672 llamadas desde julio, ninguna en setiembre.
  Se decide después del cierre de mes.
