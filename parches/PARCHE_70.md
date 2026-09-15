# PARCHE 70 — ACABADO en solo lectura y "Quién reclamó" para supervisión

## 1. ACABADO: entrar a una operación ya completa

En la lista de operaciones de una OF, la que llegaba al corte real se pintaba
apagada y **se quedaba sin `onclick`**: no había forma de abrirla. Eso dejaba sin
ver quién había registrado esas cantidades justo cuando más se pregunta.

Ahora se abre igual, en **solo lectura**:

- Se ocultan la caja de cantidad, el selector de causa y el botón REGISTRAR.
- Queda el detalle (`Completa: 100 de 100 und` en vez de `Quedan N`) y el
  histórico de la operación: quién registró, cuánto y cuándo.
- El badge pasa de `completa` a `completa · ver`, para que se note que se abre.
- Una operación pendiente no cambia en nada: sigue capturando como siempre.

No hace falta RPC nueva: el histórico ya lo daba `fn_acabado_historial`
(parche 42). La regla de "solo lectura" vive en `ACAB.ver`.

## 2. Supervisión: "Quién reclamó"

Pestaña nueva en la vista de supervisora, con tres filtros que van apareciendo
en orden para ir acotando:

1. **OF** — siempre visible. **Sin OF no se muestra nada**, ni en la pantalla ni
   en la respuesta de la BD.
2. **Módulo** — aparece al elegir OF.
3. **Operación** — aparece al elegir OF y se acota al módulo elegido. Se puede
   saltar el módulo si ya se sabe la operación.

Y debajo, quién reclamó: nombre, fecha y hora, más **numeración** a la derecha.
Mientras no se fije la operación, cada renglón lleva también su módulo y su
operación; en cuanto se fija, esa línea desaparece porque sería repetirla.

**En ACABADO la columna de la derecha es la CANTIDAD, no la numeración**, porque
ACABADO no pasa por el almacén y sus reclamos no llevan numeración (solo 2.280 de
4.316 la tienen, y son los antiguos). Lo decide `es_acabado` en la respuesta.

### Base de datos

Función nueva **`fn_sup_reclamos_of(p_dni, p_token, p_area, p_of, p_modulo, p_nop)`**.

Una sola llamada por cambio de filtro: devuelve a la vez las opciones del filtro
siguiente y las filas que ya calzan, así que el frontend no encadena consultas.

- Las OF salen de `reclamos`, **no** de `tickets_cache`: ACABADO no pasa por el
  almacén y con `tickets_cache` su lista saldría vacía (ver parche 67). Además así
  solo se ofrecen OF que de verdad tienen algo reclamado.
- Tope de **400 filas**, con `total` aparte para decir "mostrando 400 de 2.062".
  Una OF de costura llega a ~2.000 reclamos y esto se ve en el celular.
- Las operaciones **sin N°OP** no se ofrecen como opción: el filtro es por número
  y elegirlas no filtraría nada. Siguen saliendo con "Todas las operaciones".
- Permisos con el mismo criterio que `fn_avance_area`: SUPERVISORA solo su área
  actual, INGENIERIA cualquiera.

## 3. Arreglos de diseño que arrastraba la pestaña nueva

- **Pestañas**: con seis, repartir el ancho en celular partía las palabras letra a
  letra ("ASI/STE/NCI/A"). Por debajo de 620 px la fila pasa a deslizarse en
  horizontal y cada pestaña conserva su texto en una línea.
- **Selects de `.barra-control`**: una opción larga
  ("4 · PLANCHAR MANGAS+CANESU+CUELLO") estiraba el select por encima de su
  tarjeta. Ahora el ancho lo manda el contenedor, no la opción.

## Cómo se comprobó

- `fn_sup_reclamos_of` contra producción:
  - Sin OF (ACABADO): 118 OF y **0 filas de detalle** — la regla se cumple.
  - Con OF 9979: 2 módulos, 11 operaciones, 17 registros, `numeracion: null` y
    `cant: 1` — el caso ACABADO.
  - SACO COSTURA / OF 10365: 2.062 registros, devuelve 400, **588 ms y 99 kB**,
    con numeración `81-90`.
  - Cascada completa (OF + ENSAMBLE + N°OP 134): 9 filas, ninguna opción sin N°OP.
- La pantalla de supervisora en Chromium **a 400 px**: sin OF los filtros de
  módulo y operación están ocultos y sale el aviso; al elegir OF aparecen los dos
  y las filas; al fijar módulo y operación se manda
  `{p_of, p_modulo, p_nop}` correcto, el resumen pasa a "2 registro(s)" y la línea
  de contexto desaparece. Sin desborde horizontal.
- ACABADO en la vista de operario, también a 400 px: la operación completa queda
  clicable con badge `completa · ver` y abre con cantidad, causa y REGISTRAR
  ocultos y el histórico con sus 2 registros; la pendiente sigue capturando
  normal y muestra `Quedan 60 und de 100`.
