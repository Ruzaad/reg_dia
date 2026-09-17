# PARCHE 75 y 76 — Incidencias, limpieza de ingeniería y vista del personal

## 1. Las incidencias que desaparecían al editarlas

`fn_ocurrencia_editar` hacía:

```sql
select area_actual into v_area from operarios where dni = p_dni_op;
update ocurrencias set ..., area = coalesce(v_area, area) where id = p_id;
```

Es decir: **cualquier** edición reescribía el área de la incidencia con el
`area_actual` de la persona **hoy**. Y `fn_ocurrencias_listar` filtra por área.

Así que al cambiar minutos o fecha de alguien prestado a otra área, la fila
saltaba al área nueva y **desaparecía** de la lista que estabas mirando. No se
borraba nada: se movía de sitio.

Contra producción, **139 de 1266** incidencias de los últimos 60 días tienen
`ocurrencias.area` distinta del `area_actual` de su persona. Todas ellas se
mueven de área a la primera edición.

El área de una incidencia es la de **cuando ocurrió**. Ahora solo se recalcula
si la incidencia cambia de **persona**.

## 2. Fuera de ingeniería

- **Origen de tickets.** Las cuatro áreas ya tienen `usa_almacen = false` en
  `areas_config`: nadie lee el Sheet, como dijiste.
- **Módulos (día).**
- **Tickets libres** (pestaña y vista de asignación).

Las RPC `fn_origen_reclamos`, `fn_area_almacen`, `fn_tickets_libres` y
`fn_asignar_tickets` **siguen en la BD**. Solo se retiró su interfaz, así que
nada de lo que cuelga de ellas se rompe y se pueden volver a exponer.

## 3. Eficiencia

Una sola entrada de menú, **Eficiencia**, con subpestañas `ÁREA` / `DÍA` del
mismo estilo que el resto (`tabs sup-subtabs`). Las dos pantallas son las de
siempre, sin tocar su contenido; `#pasoDia` sigue siendo un deep-link válido y
deja el menú resaltado en Eficiencia.

## 4. Tickets · Actual

- Nuevo **Resumen por personal** en el panel lateral (aparece al buscar, igual
  que los otros dos): cantidad y minutos por persona, solo tickets ACTIVOS,
  ordenado por cantidad.
- **Ocultar liberados viene activado por defecto.** Era lo que se veía al
  liberar un ticket de ACABADO: la fila seguía en la tabla con estado
  `LIBERADO`. La cantidad sí volvía al corte —`fn_acabado_ofs` calcula lo hecho
  solo con reclamos `ACTIVO`, comprobado en producción—; lo que molestaba era
  la fila.

## 5. El STD deja de verse

Se quitó de todo lo que ve el personal: tarjeta de operación, tarjeta de
ticket (normal y de módulo final), pantalla de confirmación y trabajo sin OF.
En las tablas de ingeniería se queda, que ahí sí hace falta.

## 6. Vista del personal (parche 76)

Pantalla nueva en ingeniería (`Tickets → Vista del personal`): un interruptor
por campo que decide qué muestra la tarjeta de ticket **en COSTURA**.

| Campo | Configurable |
|---|---|
| Numeración | **no** — permanente |
| Cantidad | **no** — permanente |
| PPH | sí |
| Minutos del ticket | sí |
| Talla | sí |
| N° de operación | sí |
| Color | sí |

ACABADO **no usa esto**: su tarjeta se queda tal cual.

Numeración y Cantidad no existen como filas en `tickets_visibilidad`, así que
no se pueden apagar ni llamando la RPC a mano (comprobado: devuelve "Ese campo
no es configurable"). Si la RPC de lectura falla, el operario ve **todo**: un
error de red nunca le esconde información.

## Cómo se comprobó

Contra producción (`lmlwomurgbbzolgbkwtp`), en transacciones con `rollback`:

- Incidencia con `area = CAMISA COSTURA` de alguien con `area_actual = SACO
  COSTURA`: tras editar, el área sigue siendo **CAMISA COSTURA** (antes pasaba
  a SACO COSTURA).
- Panel de ingeniería lista los 5 campos; el operario recibe el JSON de flags;
  apagar `pph` devuelve `ok`; apagar `numeracion` devuelve el error esperado.
- `node --check` limpio en `app.js` e `ingenieria.js`; sin ids duplicados en
  los cuatro HTML; sin referencias huérfanas a lo eliminado.

Falta probarlo en el dispositivo: las subpestañas de Eficiencia, el resumen por
personal y la tarjeta de ticket con campos apagados.
