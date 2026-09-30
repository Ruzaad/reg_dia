# PARCHE 88 — Eficiencias personales: alertas, picos, resumen por operación y Gemini

## Qué cambia

**1. La eficiencia de área se oculta por ahora.** No hay control real de las horas por
área (quien empieza temprano y no avisa deja un solo registro de 575 min para sacos
y pantalón), así que esa cifra no es confiable. Se ocultó en:

- Ingeniería → Eficiencia → ÁREA: la tarjeta del área y la columna "Ef. del área"
  (también en el XLSX). Queda la eficiencia personal del día.
- Ingeniería → Tableros: la pestaña pasa a ser **Minutaje por área**; el modo
  "Eficiencia %" no se muestra.
- Avance del área (vista anterior en `app.js`): la tarjeta "Eficiencia del área".

Para volver a mostrarla: `VER_EF_AREA = true` en `ingenieria.js` y devolver la
tarjeta en `cargarAvance()` de `app.js`. No se tocó la base.

**2. Auditoría (solo ALOPEZ).**

- Umbral por defecto **95%**: más que eso es anormal.
- **Picos**: días que saltan 20 puntos o más (editable) sobre el promedio de la propia
  persona en el rango, aunque no pasen el umbral. Solo cuenta con 3 días o más.
- Columna **Su prom.** y columna **Por qué** con los porqués probables que calcula el
  servidor:

| Porqué | Regla |
|---|---|
| Pico +N | N puntos sobre su promedio en el rango |
| Incidencia | sin sus incidencias el día cae bajo el umbral |
| Varias áreas | tickets de más de un área el mismo día |
| Registro en bloque | 80% o más de sus tickets registrados en 10 minutos |
| Tickets de más | 1.8 veces o más los tickets de su día promedio |

- Filtro **Mostrar**: todo, solo sobre el umbral, solo picos, solo con incidencia.

Medido en producción (últimos 30 días, 2336 días-persona): 363 sobre 95%, 235 picos
(94 de ellos bajo 95%, que antes no se veían).

**3. El panel lateral resume por operación**, no por numeración: por cada operación,
cantidad y minutos del día sumados entre OF (con el reparto por OF), tickets y hora
de registro, contra su **historial** (la misma operación en la misma área, 60 días
previos): cantidad normal por día, máximo y **tiempo real por prenda**.
Si la cantidad del día pasa su máximo sale en rojo; si es 1.5 veces lo normal, en
ocre (solo con 3 días o más de historial). Los tickets uno por uno quedan plegados
al final.

Tiempo real por prenda = disponible × (min de la operación / min del día) / cantidad,
mediana de los días en que esa operación fue al menos el 15% de lo producido.

**4. Simulación de tiempos.** Cada operación tiene su "Tiempo por prenda" editable y
un botón **Usar tiempo real**; el cuadro de simulación (que ahora se queda fijo arriba
en PC) recalcula producido, disponible y eficiencia junto con las correcciones de
incidencias. Solo simula: no escribe nada.

**5. Tiempo idóneo con Gemini.** Botón **Analizar con Gemini** en el panel, con una
nota opcional del analista. Devuelve un resumen, los porqués, un tiempo idóneo por
operación con su confianza y razón (botón **Simular** para probarlo) y una
recomendación.

## Base de datos

`sql/parche_88.sql` — dos funciones nuevas de solo lectura, ambas con `_admin`:

- `fn_ef_auditoria_v2(p_dni, p_token, p_desde, p_hasta, p_area, p_umbral, p_pico)`
- `fn_ef_auditoria_ops(p_dni, p_token, p_dni_op, p_fecha)`

`fn_ef_auditoria` (parche 80) no se toca: la siguen usando los despliegues sin migrar.
Vuelta atrás: `sql/parche_88_rollback.sql`.

Probado contra producción sin crear nada (funciones temporales de sesión): la lista de
30 días responde en ~0.6 s y el detalle por operación en ~0.1 s.

## Edge Function `ef-gemini`

Código en `supabase/functions/ef-gemini/index.ts`. No lleva claves.

- Los datos no los manda el navegador: la función los pide a la base con la sesión de
  quien llama, así que solo el maestro puede usarla.
- **A Gemini no viajan nombres, DNI ni el texto de las incidencias**: solo operaciones,
  cantidades, minutos, tipos de incidencia y el historial.
- Los tiempos que devuelve se filtran: solo operaciones que existen y entre 0 y 5
  veces su STD.

### Cómo sacar la clave de Gemini (gratis)

1. Entrar a https://aistudio.google.com/apikey con la cuenta de Google.
2. **Create API key** → elegir o crear un proyecto → copiar la clave.
3. **No pegarla en el chat, en GitHub ni en el código.** Va solo en Supabase:
   Dashboard → proyecto samitex-cost-acab → **Edge Functions → Secrets** →
   *Add new secret* → nombre `GEMINI_API_KEY`, valor la clave → Save.
   (Opcional: `GEMINI_MODEL` para forzar un modelo. Por defecto prueba `gemini-3.5-flash` y, si está saturado, sin cupo o retirado, `gemini-3.8-flash`; si el error de Google sugiere otro modelo, también lo prueba.)

En la capa gratis Google puede usar lo que se le manda para mejorar sus modelos; por
eso no se envía nada que identifique a la persona. El cupo gratis es de unas pocas
consultas por minuto: si se pasa, la pantalla dice que se espere un minuto.

### Despliegue (lo hace el coordinador, junto con las otras ramas)

```
psql … -f sql/parche_88.sql              # o pegarlo en el SQL Editor
supabase functions deploy ef-gemini --no-verify-jwt
```

Sin la clave todo lo demás funciona; el botón de Gemini solo avisa que falta
`GEMINI_API_KEY`.

## Corrección del 30 de septiembre: los tiempos solo bajan

Ruzaad vio que se sugería subir un tiempo (de 0.5 a 1.5). La finalidad es bajar los
tiempos holgados, y nadie debe llegar a 100%: 95% o más ya es anormal.

- La simulación apunta a una **meta** (90% por defecto, editable, nunca más de 94).
- **Tiempo sugerido** = el menor entre el STD, el STD escalado a la meta y el tiempo
  real del historial llevado a la meta (este último con 3 días o más). Nunca pasa
  del STD, y el campo de tiempo no deja escribir más que el STD.
- El escalado se mide sobre el turno completo (575): el exceso que viene de
  incidencias negativas se corrige en la incidencia, no bajando tiempos, y el panel
  lo dice.
- Botón **Usar tiempos sugeridos**: aplica todos a la vez; el día queda en la meta o
  debajo (salvo lo que venga de incidencias).
- En rojo desde 95%; en ocre sobre la meta.
- Gemini recibe la meta y el `tiempo_maximo` de cada operación; lo que proponga por
  encima se recorta a ese tope, y la eficiencia resultante la calcula la función,
  no Gemini.
