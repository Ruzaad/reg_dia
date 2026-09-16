# PARCHE 71 — El área que manda es la de ORIGEN, y un ticket vale como asistencia

## 1. Área origen

Incentivos, la asistencia de supervisora y su lista de personal agrupaban por
**`area_actual`**. Quien está prestado a otra área —origen ACABADO, actual SACO
COSTURA— desaparecía de su área madre y **nadie podía marcarlo**: la supervisora de
ACABADO no lo veía, y la de SACO COSTURA tampoco, porque no es suyo.

El área madre es la de **origen**, así que es la que agrupa. Hoy son **22 de 163**
operarios activos. En ACABADO la diferencia es visible: pasa de 15 personas a 23.

Cambia en:

| Función | Qué agrupa ahora |
|---|---|
| `fn_incentivos_quincena` | `o.area_origen`, y la columna del JSON pasa a llamarse `area_base` para que el nombre no siga diciendo "actual" |
| `fn_asistencia_marcar_lista` | el personal que ve la supervisora |
| `fn_asistencia_marcar_guardar` | a quién puede marcar (antes `area_actual = s.area_actual`) |
| `fn_personal` | la lista de su gente |

**Lo que NO cambia, a propósito:**

- El área de la propia supervisora sigue siendo `s.area_actual`: esa es su
  asignación, no un préstamo.
- **Avance del día** y **Eficiencias** siguen por área actual. Ahí la pregunta es
  qué se produjo *en* el área ese día, y quien está prestado produce donde está.

## 2. Asistencia por ticket

Quien reclamó al menos un ticket ese día estuvo en planta. Marcarlo ausente es un
error de captura que cuesta caro: en Incentivos **cualquier penalidad anula la
quincena entera**.

`fn_asistencia_marcar_lista` devuelve ahora `tickets` por persona y, con
`tickets > 0`, el estado efectivo pasa a `ACTIVO`. La marca guardada **no se pisa en
la base**: se sigue devolviendo en `estado_guardado`, para que la contradicción sea
visible y la decisión siga siendo de la supervisora.

En la pantalla:

- Cada persona con tickets lleva una pastilla verde `🎫 N`.
- Al abrir su ficha se lee "Reclamó N ticket(s) hoy: asistió".
- Si aun así se le pone una ausencia, se avisa de que le anula la quincena y se pide
  confirmación. **Se avisa, no se impide**: puede haber un motivo real.

## Cómo se comprobó

- `fn_incentivos_quincena` del 1 al 15 de setiembre: `ok`, 163 personas, y ACABADO
  pasa de 15 a **23** personas, que es justo la diferencia entre origen y actual.
- Conteo directo sobre `operarios`: 23 con `area_origen = 'ACABADO'` frente a 15 con
  `area_actual = 'ACABADO'`.
