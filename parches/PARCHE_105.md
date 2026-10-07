# PARCHE 105 — Revisión de datos al cargar OFs, HN y BASES

## El problema

Pendiente 6 de la lista del 7-oct: al cargar una OF no se avisaba si le faltaba
BASE o STD en el área que la va a coser, ni de datos raros en la HN. Y en
OFs registradas cada OF salía con las 4 áreas: una camisa decía
"SACO COSTURA · sin BASE", así que el aviso real se perdía en el ruido.

## El cambio

Todo son **avisos**: nada bloquea. La HN se registra igual aunque no exista BASE.

Qué hace cada área (lo dijo Ruzaad): ACABADO todo; CAMISA COSTURA blusas y
camisas; PANTALON COSTURA pantalones, faldas y vestidos; SACO COSTURA sacos,
casacas, chalecos y ternos. Está en `PRENDA_AREAS` de `ingenieria.js`.

- **Dar de alta una OF (HN)**: cada hoja trae "Revisión de datos": a qué áreas
  va la prenda, si allí hay BASE y si tiene operaciones sin STD, si el artículo
  tiene BASE en un área de costura que no hace esa prenda, filas de más de 60
  und, filas sin color, tallas que no aparecen en ninguna OF registrada y un
  número de OF lejos de los últimos.
- **OFs registradas**: la columna Áreas muestra solo las áreas de esa prenda,
  nueva etiqueta "N op. sin STD" y una fila "Con avisos" (Sin BASE, BASE sin
  STD, Sin desglose, Prenda sin área) que filtra la tabla.
- **Bases › Subir Excel**: avisa operaciones sin STD, filas sin PRENDA, prenda
  que no corresponde al área elegida y N°OP repetido.

### Base (`sql/parche_105.sql`)

- Nueva `fn_of_revisar_articulo(p_dni, p_token, p_articulo)`: BASE del artículo
  por área (operaciones, cuántas sin STD, prendas). Solo lectura.
- `fn_ofs_listar`: cada área trae además `sin_std`. Campo nuevo; el front
  anterior lo ignora.

Sin el parche, el front nuevo funciona igual pero sin la parte de BASE/STD en
la revisión de la HN.

## Rollback

`sql/parche_105_rollback.sql` (deja `fn_ofs_listar` como estaba y borra
`fn_of_revisar_articulo`).
