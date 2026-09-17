# PARCHE 77 — Tardanzas y el STD configurable

## 1. Una tardanza ya no anula la quincena

La regla estaba escrita así:

```sql
/* Cualquier penalidad anula toda la quincena. */
'penalizado', (t.faltas + t.tardanzas + t.boleta) > 0,
```

Los tres contadores iban en la misma suma, así que **una sola tardanza** dejaba
la bonificación en cero igual que una falta.

Ahora:

| | Anula la quincena |
|---|---|
| Falta | con **1** |
| Boleta | con **1** |
| Tardanza | a partir de la **3.ª** del periodo |

```sql
'penalizado', ((t.faltas + t.boleta) > 0 or t.tardanzas >= 3),
```

El frontend no cambia: lee `penalizado` y `final` tal como los manda el
servidor.

### Qué cambia en la quincena 1–15 set

Tres personas tienen tardanzas en ese rango, todas con exactamente una:

| Persona | Tard. | Faltas | Boleta | Antes | Ahora |
|---|---|---|---|---|---|
| MONTES ALVA, MARIA ELENA | 1 | 0 | 0 | S/0 | **S/51.26** |
| PANCHE PRIETO, ODOÑA SANTOSA | 1 | 1 | 0 | S/0 | S/0 (por la falta) |
| FLORIAN VELASQUEZ, JESSICA MARIA | 1 | 1 | 5 | S/0 | S/0 (falta y boleta) |

## 2. El STD, configurable

En el parche 75 el STD se quitó a secas de lo que ve el personal. Ahora es un
campo más de **Vista del personal**, con su interruptor, y **entra apagado**:
el comportamiento por defecto es el mismo que quedó en el 75, pero se puede
volver a encender sin tocar código.

La lista de campos configurables de COSTURA queda:

| Campo | Por defecto |
|---|---|
| STD (minutos por prenda) | **oculto** |
| PPH | visible |
| Minutos del ticket | visible |
| Talla | visible |
| N° de operación | visible |
| Color | visible |

Numeración y Cantidad siguen siendo permanentes. ACABADO sigue sin usar esta
configuración.

El STD vuelve a aparecer, cuando se enciende, en los cuatro sitios de donde se
había quitado: tarjeta de operación, tarjeta de ticket (normal y de módulo
final), pantalla de confirmación y trabajo sin OF.

## Cómo se comprobó

Contra producción (`lmlwomurgbbzolgbkwtp`), en transacciones con `rollback`:

- MONTES ALVA con su 1 tardanza real: `penalizado = false`, cobra **S/51.26**.
- A la misma persona se le insertaron 2 tardanzas más (3 en total):
  `penalizado = true`, `final = 0`. El umbral corta donde toca.
- Las dos personas con falta/boleta siguen penalizadas.
- El panel lista el STD primero con `visible = false`; el operario recibe
  `std:false` en sus flags; encenderlo devuelve `ok`.
- `node --check app.js` limpio.

## Ojo

En producción los campos **Minutos del ticket** y **N° de operación** están
ahora mismo **apagados** (`minutos:false`, `nop:false`). Si no fue a propósito,
se encienden desde la misma pantalla.
