# PARCHE 92 — Tickets a nombre de quien no los hizo

> **Sin aplicar.** Lo corre Ruzaad en el SQL Editor (`sql/parche_92.sql`).
> Vuelta atrás: `sql/parche_92_rollback.sql`.

## Qué pasaba

**1. Tickets con el DNI de Ingeniería.** El 4, 17 y 25 de setiembre se
registraron tickets de CAMISA COSTURA con el usuario `LFABIAN` (Ingeniería). Lo
prueban `movimientos_area` y las notificaciones "pasó a CAMISA COSTURA, se movió
solo al reclamar un ticket" de esos días. Esas filas se corrigieron después a mano
(ya no hay ningún reclamo con DNI de Ingeniería), pero `LFABIAN` se quedó con
`area_actual = CAMISA COSTURA`.

Cómo entraba:

- "Entrar como" y "Operar como supervisora" guardaban la sesión prestada en
  `localStorage`, que comparten todas las pestañas del navegador. Si en la PC de
  Ingeniería había dos pestañas, la que seguía mostrando a un operario
  registraba con la sesión que se guardó al último: la de otro operario, o la
  de Ingeniería al volver con 🏭.
- "Operar como supervisora" dejaba la sesión de Ingeniería **con área**.
  `operario.html` no revisaba el cargo, así que con esa sesión abría la
  pantalla del operario y registraba a nombre de Ingeniería.
- La base no revisaba el cargo de quien registra.

**2. "Aparece un ticket diferente".** Revisado contra la base: los códigos no se
cruzan entre áreas. El código es `paquete + OF + '1' + op_id` y el `op_id` es
único en toda la BASE, así que el mismo código no existe en dos áreas ni en dos
operaciones. En los últimos 10 días (46 mil reclamos de costura), cada reclamo
coincide con su ticket del almacén en OF, módulo, operación, N°OP, STD y
artículo. El dato equivocado no lo inventó la base: llegó así desde la
pantalla. Puede venir de la sesión de otra pestaña (punto 1) o de haber tocado
otra operación. Lo de Valdivia del 29/09 a las 09:36 fue un lote de MARCAR+PEGAR
BOLSILLO de la OF 10419 desde su propia sesión. Esos tickets se liberaron como
"error op" y luego los registró MONTES ALVA.

Aun así, `fn_reclamar` y `fn_reclamar_lote` copiaban lo que mandaba el teléfono
(OF, operación, STD…) sin compararlo con el almacén.

## Qué cambia

**Base**

- Trigger `reclamos_solo_planta_trg` (BEFORE INSERT en `reclamos`): solo
  OPERARIO o ESTAJERO pueden registrar. Si no, falla con "Estás con el usuario de
  X (INGENIERIA)…". Cubre las 3 webs y todas las RPC que insertan en `reclamos`.
- `fn_reclamar` y `fn_reclamar_lote` (mismas firmas): toman OF, módulo,
  operación, N°OP, STD, artículo, color, talla, paquete y numeración del almacén
  de **esa área** (`tickets_cache`, o `residuales` si es un saldo). Lo que manda
  el teléfono se ignora. Un código que no está en el almacén del área se rechaza.
  En el lote se informa como conflicto ("No está en el almacén: …"). El lote
  ahora también compara la cantidad y guarda `codigo_padre` de los saldos, igual
  que el reclamo individual.
- `LFABIAN` (y cualquier INGENIERIA) vuelve a `area_actual = INGENIERIA`.

**Front** (`app.js`, `ingenieria.js`)

- "Entrar como" y "Operar como supervisora" guardan la sesión prestada solo en
  esa pestaña (`sessionStorage`). La de Ingeniería queda intacta en
  `localStorage` y 🏭 solo suelta la prestada.
- Cada pantalla de operario y supervisora fija el DNI con el que abrió. Si la
  sesión guardada pasa a ser de otra persona (otra pestaña u otro login en el
  mismo equipo), no manda nada más: avisa y se recarga.
- `operario.html` solo abre con cargo OPERARIO o ESTAJERO.
- La confirmación dice "a nombre de APELLIDOS", leído de la sesión en ese
  momento.

## Verificar después de aplicar

```sql
select tgname from pg_trigger where tgname = 'reclamos_solo_planta_trg';
select prosrc like '%parche 92%' from pg_proc where proname in ('fn_reclamar','fn_reclamar_lote');
select dni, area_actual from operarios where cargo = 'INGENIERIA';
```
