# PARCHE 94 — Ingeniería · REEMPLAZAR LA HN AUNQUE LA OF TENGA RECLAMOS

## Para qué

Con el parche 89, "Reemplazar lo registrado con esta HN" se negaba si la OF
tenía un solo ticket reclamado, así que en la práctica casi nunca se podía.

## Qué se ve (ingenieria.html → OFs registradas → Dar de alta una OF)

- Se marca **Reemplazar lo registrado con esta HN** igual que antes.
- Si ningún paquete con reclamos cambia, se reemplaza directo.
- Si la HN nueva cambia o quita paquetes que ya tienen tickets reclamados,
  aparece una confirmación con la lista (paquete, talla · cantidad antes y
  ahora, cuántos tickets). Si se acepta, se reemplaza; si no, esa OF se salta.

## Qué cambia en la base

`fn_of_reemplazar` gana un parámetro `p_forzar boolean default true`:

- Ya no se niega por tener reclamos.
- Si hay reclamos ACTIVO en paquetes que cambian o desaparecen y no se fuerza,
  devuelve `confirmar: true` con `paquetes_reclamados` y no escribe nada.
- Los reclamos no se tocan: guardan su propia cantidad, talla y numeración,
  así que lo ya ganado no cambia.
- Lo demás igual que el parche 89 (terno: solo la prenda indicada; refresca el
  caché de tickets de las áreas generadas).

Los despliegues sin migrar llaman con 7 parámetros y reemplazan directo
(default true): los paquetes que la HN ya no trae se borran del desglose. La
pantalla nueva manda `p_forzar=false` y pide confirmar primero. Se cambió a
true el 5 oct porque la primera versión (default false) trababa la OF 10257
desde la pantalla vieja.

Aplicar: correr `sql/parche_94.sql` en el SQL Editor.
Deshacer: `sql/parche_94_rollback.sql` (vuelve a la versión del parche 89).

## Cómo se probó

- La consulta que detecta paquetes reclamados se corrió de solo lectura sobre
  la OF 10425 (11 paquetes con 26-29 reclamos cada uno): encuentra los 11 con
  su talla y cantidad. Los reclamos sin código (por OF) no cuentan como paquete.
- ingenieria.js pasa la revisión de sintaxis con node.
