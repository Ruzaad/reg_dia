# PARCHE 73 — Modular por área actual, override manual, INGENIERIA fuera y el modal

## 1. El modular es del área ACTUAL

El bono modular premia el esfuerzo del **área en el día**, así que le toca al área
donde la persona **trabaja**: si es de ACABADO pero está prestada a CAMISA COSTURA,
cobra el modular de CAMISA COSTURA, que es al que aportó.

Ojo con la distinción, que son dos preguntas distintas:

| | Área que se usa |
|---|---|
| Bajo qué área **aparece** en el reporte | **origen** (parche 71) |
| De qué área cobra el **modular** | **actual** |

Comprobado contra producción: LIZARRAGA MAMANI (origen ACABADO, actual CAMISA
COSTURA) sale agrupada en ACABADO pero su modular bruto es **S/36** —los 9 días de
CAMISA COSTURA— y no los S/69 de ACABADO.

## 2. Override manual

Un botón de 20 px pegado al nombre, en la tabla de quincena. Tres estados que se
ciclan con clic:

| | Qué hace |
|---|---|
| `◦` gris | **Automático**: lo decide el promedio ≥ 70% |
| `✓` verde | **Forzado**: se paga aunque no llegue al 70% |
| `✕` rojo | **Anulado a mano**: no se paga |

Forzarlo levanta **solo** la puerta del 70%, **no** el descuento por día: se siguen
pagando únicamente los días en que esa persona tuvo porcentaje.

El override es de **esa quincena**: el rango va en la clave, así que la siguiente
vuelve a decidirse sola. La columna Modular distingue en su tooltip si está
"Forzado a mano", "Anulado a mano" o simplemente por debajo del 70%.

## 3. INGENIERIA fuera

No es un área de planta: no se supervisa ni entra en bonificaciones. Se colaba en
**todos** los selectores porque `fn_areas_listar` saca las áreas de `operarios`, y
los cuatro usuarios de ingeniería tienen `area_actual = 'INGENIERIA'`.
`areas_config` nunca la tuvo.

Ahora la función la excluye, y `fn_incentivos_quincena` también deja fuera a quien
tenga esa área de origen. En la práctica esto último ya no cambiaba nada —esos
cuatro son `cargo = 'INGENIERIA'` y el cálculo solo mira `OPERARIO`— pero deja la
regla escrita donde toca.

La lista real pasa a ser: ACABADO, CAMISA COSTURA, CORTE, PANTALON COSTURA,
REPROCESO, SACO COSTURA, UDP.

## 4. El modal de minutos de consideración

Se veía todo en línea porque usé `.campo` con `<span>`, y `.campo` **no tiene
estilos fuera de `.barra-control`**. La convención de los modales de este proyecto
es `.modal-campo` con `<label>`, más `.modal-2col` para las parejas y `.modal-msg`
para el error. Corregido: DNI y Fecha en dos columnas, minutos y motivo a lo ancho,
y la etiqueta encima de cada campo.

## Cómo se comprobó

- `fn_areas_listar` contra producción: las 7 áreas reales, sin INGENIERIA.
- El modular por área actual, sobre los datos reales de la quincena 1–15 de
  setiembre (ver arriba, LIZARRAGA).
- En Chromium: los tres estados del botón se pintan como toca, el clic cicla
  automático → forzado y manda `{p_dni_op, p_desde, p_hasta, p_forzar:true}`, la
  columna Modular muestra el tooltip correcto en cada caso, el selector de área ya
  no ofrece INGENIERIA, y en el modal la etiqueta queda **encima** del campo
  (`apilado: true`) con las dos columnas de DNI/Fecha.
