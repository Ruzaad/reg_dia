# PARCHE 85 — Supervisora · AVANCE OF y BASES

> **Aplicado en producción el 24-set-2026**, con autorización de Ruzaad.

## Para qué

Que la supervisora vea en el celular cómo va cada OF abierta de su área, y los
tiempos STD de los artículos de su área, sin pedírselos a Ingeniería.

## Qué se ve (supervisora.html)

- **AVANCE OF** reemplaza a "AVANCE DEL DÍA" (se quitan los KPI de eficiencia,
  presentes y minutos). Buscador por OF o artículo que filtra al escribir, sin
  consultar la base. Las OF salen cerradas; al abrir una salen sus módulos,
  también cerrados, con su estado (EN PROCESO / COMPLETADO), % y barra. Al
  abrir un módulo salen sus operaciones (N° OP, nombre, producida/programada,
  %) de 5 en 5 con "Ver N más". Se actualiza cada 60 s y conserva lo abierto.
- **BASES** (pestaña nueva, solo lectura): artículos del área con prenda,
  cliente, N° de operaciones, N° de módulos y STD total. Se busca por artículo,
  cliente o prenda al instante y, desde 3 letras, también por operación. Al
  abrir un artículo salen sus módulos con la suma de STD y, dentro, las
  operaciones de 5 en 5.
- Ingeniería, en "Operar como → Supervisora", sigue con la vista anterior.

## Reglas de cálculo

Las mismas del "Resumen de OF" de Ingeniería (`fn_of_trazabilidad`):

- Módulo: su referencia es la última operación de la ruta BASE; % = lo
  reclamado (tickets ACTIVOS) en esa operación ÷ cantidad programada de la OF.
  Está COMPLETADO cuando llega a lo programado o si se cerró a mano
  (`modulos_cerrados`).
- OF: % = promedio del % de sus módulos (cada módulo aporta como mucho 100).
- OF abierta = tuvo tickets en el área en los últimos 30 días y le queda algún
  módulo sin completar. Solo cuentan los módulos que ya empezaron.

## Qué cambia en la base

Solo agrega funciones de lectura; ninguna tabla cambia.

| Función | Para qué |
|---|---|
| `_avance_of_base(area, of, modulo)` | Interna: una fila por operación del módulo con lo producido. Sin permisos para `anon`/`authenticated`. |
| `fn_avance_of(dni, token, area)` | Lista de OF abiertas con sus módulos, sin operaciones (~18 KB en SACO). |
| `fn_avance_of_ops(dni, token, area, of, modulo)` | Operaciones de un módulo, al abrirlo. |
| `fn_bases_area_articulos(dni, token, area, buscar)` | Artículos del área con STD total; con `buscar`, los artículos que tienen esa operación. |
| `fn_bases_area_ops(dni, token, area, articulo)` | Operaciones de un artículo, al abrirlo. |

Permisos: SUPERVISORA solo su área actual; INGENIERIA cualquiera.
`fn_avance_area` se queda (la usan Ingeniería y los despliegues sin migrar).

Para deshacer: `drop function` de las cinco.

## Cómo se probó

En producción dentro de una transacción que siempre se deshace:

- SACO COSTURA: 21 OF abiertas, lista en 0,7 s y 18 KB; operaciones de un
  módulo en 34 ms; artículos (93) en 22 ms y 10 KB; operaciones de un artículo
  en 2 ms. Antes de separar las operaciones, la misma consulta tardaba 2 s y
  pesaba 190 KB en CAMISA.
- Supervisora de SACO pidiendo CAMISA → NO_AUTORIZADA. Ingeniería → pasa.
- Búsqueda con `%` y `_` no se toma como comodín.
- Pantalla a 360, 390 y 768 px: sin desborde horizontal, textos largos
  ("REMALLAR BOLS.FORR(BOLS. CONTRAP+PORTA LAPIC.+CIGARR.) + LIMP. HILO -
  FORRO", "MINISTERIO DE RELACIONES EXTERIORES") y números de 5 dígitos.
