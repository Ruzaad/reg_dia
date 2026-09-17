# PARCHE 74 — Sesión deslizante, ráfagas de SESION_INVALIDA y horario de operación

## 1. La sesión ya no muere a las 4h de haber entrado

`fn_login` daba `token_expira = now() + 4 hours` y `_auth` solo comprobaba
`token_expira > now()`: nadie renovaba nada. Quien entraba a las 7:00 quedaba
fuera a las 11:00 **aunque estuviera usando la app en ese momento**.

Ahora la ventana es **deslizante**: 4 horas **sin usar** la app, no 4 horas desde
el login. `_auth` renueva en cada llamada autenticada, con dos frenos:

| | |
|---|---|
| Inactividad tolerada | 4 h |
| Tope duro desde el login | 18 h (`operarios.token_creado`, nuevo) |

El `UPDATE` de renovación solo se dispara cuando queda **menos de media
ventana** (2 h). Una pantalla del operario lanza 6 RPC a la vez; sin ese freno
serían 6 escrituras sobre `operarios` por pantalla. Con él, como mucho una cada
2 horas por persona.

El mismo criterio está del lado del navegador (`guardarSesion` / `renovarSesion`
en `app.js`, `SESION_HORAS` = 4, `SESION_MAX_HORAS` = 18), para no mandar RPC que
ya sabemos muertas.

## 2. Las ráfagas de los logs

Las dos ráfagas del 19:04 y 18:20 (Lima) —`fn_reclamados`, `fn_residuales`,
`fn_mis_paquetes`, `fn_ofs_area`, `fn_mi_dia`, `fn_areas_config_listar` casi en
el mismo instante— **no eran seis usuarios**: es `cargarTodo()`, que dispara
esas RPC en un solo `Promise.all`. Con el token vencido las seis fallaban y las
seis llamaban a `cerrarSesion()`, encadenando 6 redirecciones a `index.html`.

`rpc()` ahora llama a `sesionVencida()`, con guard `_cerrandoSesion`: la primera
gana, avisa con un toast ("Tu sesión venció, vuelve a ingresar") y redirige una
sola vez. `cerrarSesion()` lleva el mismo guard.

Con el punto 1, además, esas ráfagas deberían dejar de ocurrir salvo tras 4h
reales de inactividad.

## 3. La pantalla que no se actualiza al cambiar de área

Al cambiar de área (modal del operario o grilla del estajero), `cargarTodo()`
refrescaba `ALM`, `RECL`, `OF_LISTA` y `OF_CARGADAS`… y nada más. Quedaban vivos
de la **anterior**:

- `sel` (OF / módulo / operación / ticket),
- `ACAB` y `CAUSAS` (estado de ACABADO),
- `MISREG`, `MISREG_ABIERTA`, `MISPAQ`, `NOPS_FIN`, `modoSel`, `marcados`, `SR`,
- **el texto de los buscadores** `inputOF` y `acabBuscaOF`.

Ese último es el que más se nota: se entra al área nueva con el filtro puesto
en una OF que ahí no existe, la lista sale vacía o con restos, y parece que la
pantalla "no cargó". Nuevo `resetEstadoArea()`, llamado al principio de
`cargarTodo()`, limpia todo eso y vacía las listas pintadas antes de cargar.

## 4. Horario de operación (7:00–22:00 Lima)

**Supabase no se puede apagar por horario.** Un proyecto de pago está siempre
encendido; pausar/restaurar es manual y tarda minutos, y lo que se ahorra son
Compute Hours que igual se facturan por proyecto activo. Así que el horario se
aplica **a nivel de aplicación**, que es lo que en la práctica se busca: que
fuera de hora nadie pueda loguearse ni registrar.

Tabla nueva `sistema_config` (clave/valor, sin acceso para `anon`) y
`fn_horario_ok()`. `fn_login` devuelve un error legible fuera de hora y `_auth`
levanta `FUERA_DE_HORARIO`, que el front traduce a un mensaje claro.

**Se instala APAGADO.** Para encenderlo:

```sql
update sistema_config set valor='true' where clave='horario_activo';
```

Para cambiar la ventana (o apagarlo):

```sql
update sistema_config set valor='06:30' where clave='horario_desde';
update sistema_config set valor='22:00' where clave='horario_hasta';
update sistema_config set valor='false' where clave='horario_activo';
```

Ojo antes de encenderlo: a las 22:00 corta **también a quien esté trabajando**,
y no hay excepción por cargo. Si hay turno que se pasa de hora, conviene dejar
`horario_hasta` con holgura.

## Cómo se comprobó

Contra producción (`lmlwomurgbbzolgbkwtp`), en transacciones con `rollback`:

- Sesión a 30 min de vencer y login hace 1 h → tras `_auth`, expira en **4:00:00**.
- Sesión a 30 min de vencer y login hace 17 h 30 → tras `_auth`, expira en
  **0:30:00** (el tope de 18 h manda, no renueva de más).
- Sesión con 2 h 46 min por delante → `_auth` **no** escribe (freno de media
  ventana).
- `fn_horario_ok()` = `true` con el horario apagado; `false` con el horario
  encendido y la ventana fuera de la hora actual.
- `node --check app.js` limpio.

Queda pendiente probar el punto 3 en el dispositivo: cambiar de área con una OF
escrita en el buscador y confirmar que la lista del área nueva sale completa.
