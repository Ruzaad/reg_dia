# PARCHE 79 — Resumen de OF: exportar OPERACION FINAL a carpetas

## Qué hace

Botón nuevo **📁 Exportar a carpetas**, al lado del ⬇ Descargar de siempre.
El de siempre **no se tocó**: sigue bajando `RESUMEN_OF.xlsx` con sus tres
hojas, igual que hoy.

El nuevo pide la **carpeta raíz**, que debe contener `Acabado` y `Costura`, y
deja en cada una un `OPERACION_FINAL.xlsx` con esa única hoja, ya filtrada:

| Área de la fila | Carpeta |
|---|---|
| `ACABADO` | **Acabado** |
| cualquiera que contenga `COSTURA` | **Costura** |

En producción `bases` solo tiene ACABADO, CAMISA COSTURA, PANTALON COSTURA y
SACO COSTURA, así que la regla las cubre todas. Aun así, si algún día aparece
un área que no encaje, **no se descarta en silencio**: se avisa cuántas filas
quedaron fuera y de qué áreas.

Los nombres de carpeta se buscan sin distinguir mayúsculas ni acentos, así que
`acabado`, `Acabado` o `ACABADO` valen igual.

## El merge

No pisa el archivo: lo **fusiona**. La identidad de una fila es
**OF + Área + Módulo**.

- La fila que vuelve a salir en la descarga → se **refresca** con los datos
  nuevos, **en su sitio** (no se mueve al final).
- La fila que ya estaba y **no** viene esta vez → se **respeta** tal cual.
- Lo que no existía → se **agrega al final**.

Así el archivo acumula historia entre descargas sin duplicar nada, y volver a
exportar lo mismo dos veces no lo hace crecer.

La clave se normaliza con `normKey` (sin mayúsculas, acentos ni signos), así
que `SACO COSTURA` y `saco  costura`, o `MOD-1` y `MOD 1`, se reconocen como la
misma fila aunque el archivo viejo tenga otro tipeo.

Al terminar avisa qué pasó en cada carpeta: `Acabado: 120 fila(s)
(8 actualizada(s), 3 nueva(s)) · Costura: …`

## Navegador

Elegir una carpeta y **leer** lo que ya hay dentro necesita la File System
Access API: **Chrome o Edge**. En Firefox y Safari no existe.

Ahí el botón no falla: baja los dos archivos sueltos
(`ACABADO_OPERACION_FINAL.xlsx` y `COSTURA_OPERACION_FINAL.xlsx`) y **avisa
expresamente que en ese camino NO hay fusión**, porque sin acceso a la carpeta
no hay forma de leer el archivo anterior. Mejor eso que fusionar a medias sin
decirlo.

Si se cancela el diálogo de carpeta, no pasa nada ni se muestra error.

## Cómo se comprobó

No se puede abrir el selector de carpetas desde aquí, así que se probó todo lo
que sí es verificable: la lógica pura y el ida y vuelta contra archivos `.xlsx`
reales, con **la misma versión de SheetJS que carga la app** (0.18.5).

**21 pruebas** de reparto y fusión:

- ACABADO → Acabado; las tres de costura → Costura; CORTE y vacío → ninguna.
- La clave usa OF, Área y Módulo, y tolera espacios, guiones y acentos.
- Fusión: actualiza en su sitio, respeta lo que no vuelve a salir, agrega lo
  nuevo al final, no duplica, y no muta el arreglo de entrada.
- Misma OF y módulo en áreas distintas **no** colapsan en una fila.

**14 pruebas** de ida y vuelta escribiendo y releyendo `.xlsx` de verdad:

- La hoja se llama `OPERACION FINAL` y la cabecera sale con las 12 columnas.
- Simulación de tres exportaciones seguidas: un módulo avanza de 100 a 950,
  aparece uno nuevo, y el que no venía conserva su valor. Sin duplicados.
- Re-exportar lo mismo no hace crecer el archivo.
- Las celdas vacías (`Salida` en blanco) no corren las columnas: Área y Módulo
  siguen en su sitio tras la ida y vuelta.

Falta probarlo en el equipo: abrir el selector, elegir la raíz real y confirmar
que escribe en las dos carpetas.
