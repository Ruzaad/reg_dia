# PARCHE 91 — Operaciones adicionales por OF en costura (no valorizadas)

> **Sin aplicar.** Va en el despliegue conjunto con los parches 88-90.

## Para qué

En costura, por fallas de otra área, a veces hay que hacer operaciones que no
están en la BASE del artículo (descoser, rehacer, reponer una pieza…). No se
agregan a la BASE porque no siempre pasan, así que el artículo no se
revaloriza. Pero alguien las trabajó: sus minutos no se pueden perder, y
Ingeniería necesita verlas ligadas a su OF.

Las **Operaciones sin OF** de ACABADO (parche 27) siguen igual. Aquellas son un
catálogo fijo por área y se registran sin OF. Estas se dan de alta para una OF
concreta.

## Qué se ve

**Ingeniería → Generar tickets → ADICIONALES POR OF.** Se elige el área (sin
ACABADO) y, opcionalmente, la OF:

- Sin OF: las adicionales del área de los últimos 60 días.
- Con OF: sus adicionales y el formulario de alta:
  - Módulo: solo los de la BASE del artículo de la OF.
  - Operación y STD.
  - Cantidad autorizada: si queda vacía, no hay límite.
  - Motivo (obligatorio).
  - Área que falló (opcional).
- La tabla muestra lo autorizado, lo hecho, los minutos y quién lo hizo.
- **Editar** cambia STD, cantidad autorizada, motivo y área que falló. Si cambia
  el STD, también se corrige en lo ya registrado, igual que al corregir la BASE.
- **Desactivar** la quita de la vista del operario sin borrar lo registrado.

**Operario de costura.** Al abrir una OF que tiene adicionales activas, aparece
una tarjeta **ADICIONALES** encima de los módulos. Dentro, el operario toca la
operación y escribe la cantidad que hizo. Si hay tope, ve cuántas und quedan.
No hay ticket ni numeración: se registra por cantidad, como en ACABADO.

## Qué cambia en la base

- Tabla nueva `ops_adicionales_of`: área, OF, artículo, módulo, operación, STD,
  tope, motivo, área de origen, activa y quién la creó. No se puede repetir la
  misma área, OF, módulo y operación. Tiene RLS y ningún permiso para anon ni
  authenticated: solo se usa por RPC.
- `reclamos.op_adicional_id`: columna nueva, con índice parcial. El registro del
  operario es una fila más de `reclamos`, sin código, sin N°OP y sin `op_id`:
  - Suma sus minutos al día de la persona: eficiencia, incentivos y auditoría.
  - No cuenta como avance de la OF, porque todo el avance se calcula por N°OP.
  - Su módulo siempre es uno de la BASE, así que no aparece un módulo "fantasma"
    que deje la OF sin terminar en el Resumen de OF.
- RPCs nuevas:
  - `fn_opad_listar(dni, token, area, of)`: cualquier sesión. El operario debe
    dar la OF y solo ve las activas. Ingeniería también ve las inactivas, quién
    las hizo y los módulos de la BASE.
  - `fn_opad_guardar(dni, token, id, area, of, modulo, operacion, std, tope,
    motivo, area_origen, activa)`: solo `_ing`. Hace el alta o la edición.
    Rechaza estos casos:
    - ACABADO.
    - Una OF no registrada.
    - Un módulo que no está en la BASE.
    - Una operación que ya está en la BASE, porque esa sale en los tickets.
    - Un tope menor a lo ya hecho.
  - `fn_opad_registrar(dni, token, area, id, cant)`: el operario. Bloquea la fila
    para que dos personas a la vez no pasen el tope.
- Una línea en cada una de estas funciones existentes:
  - `_reclamo_op_id` (trigger): no enlaza estas filas a la BASE. Si el nombre
    coincidiera, la siguiente edición de la BASE les pondría N°OP y STD de la
    ruta, y contarían como avance.
  - `_sync_reclamos_articulo`: el mismo cuidado en su respaldo "por nombre".
  - `fn_reclamo_partir`: al partir una fila (Corregir fechas), la parte nueva
    conserva `op_adicional_id`.
  - `fn_ofs_area`: "N de M libres" solo resta reclamos con código. Si no, cada
    registro adicional descontaría un ticket libre.

Para anular un registro mal hecho se usa lo que ya existe: liberar por id
desde Ingeniería.

Vuelta atrás: `sql/parche_91_rollback.sql`. Borra las adicionales y sus
registros, y restaura las cuatro funciones.

## Para los otros parches del despliegue

- Si el 88 (eficiencias) necesita separar estos minutos, los identifica con
  `reclamos.op_adicional_id is not null`.
- Si otro parche redefine `_reclamo_op_id`, `_sync_reclamos_articulo`,
  `fn_reclamo_partir` o `fn_ofs_area`, debe conservar la línea de este.

## Cómo se probó

El parche entero se corrió en producción dentro de un bloque que se deshace al
final. Se crearon usuarios de prueba, y después se confirmó que no quedó ni la
tabla, ni la columna, ni las funciones, ni los usuarios. Caso real: SACO
COSTURA, OF 10431 (SXI306):

- Rechaza una operación que ya está en la BASE (N°OP 86), un módulo que no está
  en la BASE, ACABADO, un duplicado y un alta hecha por un operario.
- Alta de DESCOSER BOLSILLO en ENSAMBLE, STD 1,5, tope 10. El operario la ve
  con 10 libres. Registra 6. Luego pide 5 y recibe "Solo quedan 4". Registra 4.
  Pide 1 más y recibe "Ya se completó".
- Las filas en `reclamos` quedan sin código, sin N°OP y sin op_id, con 9 y
  6 minutos.
- Un tope menor a lo hecho se rechaza. Con STD 2 los minutos pasan a 20.
- Partir una fila conserva el enlace. `_sync_reclamos_articulo` no enlaza
  ninguna.
- "Libres" de la OF: 104 antes y 104 después.
- `fn_opad_listar` de Ingeniería tarda 5 ms. Una operación desactivada ya no se
  registra ni se lista para el operario.

Pantallas en Chromium, con respuestas simuladas:

- **Operario a 390 px:** la tarjeta ADICIONALES aparece sobre ENSAMBLE. Pedir
  9 con 7 libres muestra el error. Registrar 4 muestra "Van 7 de 10" y vuelve a
  la lista con 3 libres. No hay desborde.
- **Ingeniería a 1366 y 390 px:** sin OF, lista y oculta el formulario. Con OF,
  los módulos salen de la BASE. Añadir, editar el STD y desactivar mandan los
  parámetros correctos. No hay errores de consola ni desborde.
