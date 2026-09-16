# PARCHE 72 — Bono modular, eficiencia manual y minutos de consideración

Tres cosas distintas que conviene no confundir, y que ahora tienen su propia
pestaña dentro de **Incentivos**:

| | De quién | Unidad | Para qué |
|---|---|---|---|
| **Bono modular** | del **área** y del **día** | % → soles | Premiar el esfuerzo del área. No mira categorías. |
| **Eficiencia manual** | de la **persona** y del **día** | % | Áreas que no llevan tickets. **Suma** a la de tickets. |
| **Minutos de consideración** | de la **persona** y del **día** | minutos producidos | Subirle la eficiencia a quien **ya tiene** tickets. |

Las dos últimas **solo pesan en Incentivos**: Avance, Eficiencias y el badge del
operario siguen contando únicamente lo reclamado.

## 1. Bono modular

Pestaña **BONO MODULAR**, antes de QUINCENA. Una rejilla de área × día laborable
donde ingeniería escribe el % que alcanzó el área; los soles los pone
`bono_modular_tabla` y el total por área se ve en la última columna. Escribir no
recarga nada: los cambios viven en el navegador hasta GUARDAR.

La tabla de tramos (80–84 → S/6, 85–89 → S/7, 90–94 → S/8, 95–99 → S/9, 100 → S/10)
también se muestra en **TABLA DE INC.**, al lado de la de categorías, porque son las
dos que deciden cuánto se paga. Por debajo de 80% el día no paga.

### Cómo se reparte

1. Se suman los soles de cada día del rango para el área → el modular del área.
2. De ese total, **cada persona solo cobra los días en que ella tuvo porcentaje**.
   Si ese día faltó, estuvo de licencia o no entregó, **se le descuenta el modular
   de ese día** aunque el área sí lo haya ganado.
3. Se paga únicamente con **promedio de eficiencia ≥ 70%**. El promedio entra sobre
   **todos los días laborables**: el día sin porcentaje cuenta como 0 y lo baja.
4. Lo que resulte se suma al **último bono** de la quincena (el B o el C, según el
   rango).

En la tabla de quincena se añaden dos columnas: **Prom. ef.** y **Modular**. Con
promedio por debajo de 70% el modular sale **tachado**, mostrando lo que habría sido
—que es la pregunta que siempre sigue—, y el bono que lleva modular dentro va
subrayado en ocre para poder auditar de dónde sale.

## 2. Eficiencia manual

Pestaña **EFICIENCIA MANUAL**, a la derecha de TABLA DE INC. Rejilla de personas ×
días, estilo hoja de cálculo. Lo escrito **se suma** a la eficiencia por tickets, y
bajo cada celda se lee el resultado en vivo (`91+9 = 100%`); al guardar se repite el
aviso persona por persona y hay que aceptarlo. Es función de ingeniería.

Se avanza **por columna**, que es como se llena en la práctica (un día, toda la
gente):

| Tecla | Qué hace |
|---|---|
| `Enter` / `↓` | baja a la siguiente persona, misma columna |
| `↑` | sube |
| `Tab` / `→` | pasa al día siguiente |
| `Ctrl+Enter` | copia el valor de la celda a **toda la columna** |
| `Supr` | borra la celda |

## 3. Minutos de consideración

Pestaña **MIN. CONSIDERACIÓN**, con su CRUD. Son minutos **producidos** que no
salen de ningún ticket: suman al numerador del día, así que el porcentaje sube solo.
Admite negativos, para descontar algo cargado de más. Cada línea guarda motivo, quién
la registró y cuándo.

## Base de datos

Cuatro tablas nuevas, todas con RLS y accesibles solo por RPC:

- `bono_modular_tabla (pct, soles)` — los 21 tramos, de 80 a 100.
- `bono_modular_dia (area, fecha, pct)` — lo que escribe ingeniería.
- `eficiencia_manual (dni, fecha, pct)`.
- `minutos_consideracion (id, dni, fecha, minutos, motivo)` — varias líneas por día
  y persona, por eso lleva id propio y no PK compuesta.

RPC nuevas: `fn_bono_modular_tabla_listar`, `fn_bono_modular_listar`,
`fn_bono_modular_guardar`, `fn_ef_manual_listar`, `fn_ef_tickets_rango`,
`fn_ef_manual_guardar`, `fn_consideracion_listar`, `fn_consideracion_guardar`,
`fn_consideracion_eliminar`.

`fn_incentivos_quincena` se reescribe para integrar las tres cosas. Un día cuenta
como **entrega** si hubo ticket, minutos de consideración **o** eficiencia manual:
sin eso, una persona de un área sin tickets caería en `NO ENTREGO` y la penalidad le
anularía la quincena.

## Cómo se comprobó

- La tabla de tramos contra el ejemplo del usuario (ACABADO, 1–15 set, los once
  porcentajes): **S/ 48.00**, idéntico.
- El reparto por persona, contra producción:
  - AGUILAR GONZAGA: promedio **87.2%**, 11 días con porcentaje → cobra los S/48;
    su bono total pasa de 64.47 a **112.47**.
  - CASTRO AGUIRRE: solo **5 de 11** días con porcentaje → su modular baja a
    **S/33** (el descuento por día funciona) y, con promedio 26.5%, no lo cobra.
  - CHAVEZ QUISPE: 11 días y S/48 de bruto, pero promedio 51.7% → **S/0**.
- Las dos vías aditivas, sobre AGUILAR el 2 de setiembre: 619.7 min de tickets
  + 45 de consideración = 115.6%, más 7.5 de manual = **123.1%**.
- Las nueve RPC nuevas responden `ok` contra producción; los datos de prueba se
  borraron (las cuatro tablas quedaron vacías).
- Las cinco pestañas en Chromium a 1920 px: columnas Prom. ef. y Modular con el
  tachado cuando el promedio no llega, la rejilla modular recalculando soles y
  total al teclear, el aviso `91+9 = 100%` en eficiencia manual, `Enter` bajando por
  la columna y `Ctrl+Enter` copiándola entera. Sin desbordes ni errores de JS.
