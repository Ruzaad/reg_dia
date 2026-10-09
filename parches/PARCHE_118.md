# PARCHE 118 — Carga vs capacidad: que cargue y que no cuente colas

## El problema
- Con el parche 107 la pantalla daba error: la consulta tardaba de 2 a 4 s y
  la base le corta a la app a los 3 s (los registros de la base muestran
  "canceling statement due to statement timeout" el 9-oct a las 00:22).
- En las OFs ya terminadas cada área deja sin reclamar parte de sus minutos:
  operaciones que nadie marca (CAMISA ~8 %, PANTALON ~6 %, SACO ~26 %).
  Esos tickets se contaban como trabajo pendiente y alargaban los días,
  sobre todo en SACO (salía 10.4 días).

## El cambio
- Misma función `fn_carga_capacidad`, misma firma y mismo permiso, solo
  lectura. Lee reclamos una sola vez, agrupa por módulo antes de mirar los
  módulos cerrados y tiene su propio límite de 20 s (como
  `fn_incentivos_quincena`). En la base real tarda 1.5 a 2 s.
- **Pendiente real**: por cada operación se mira qué parte se reclamó en las
  OFs terminadas del área y lo que suele quedar suelto se descuenta. Si la
  operación sale en menos de 3 OFs terminadas, se usa el porcentaje del área.
  Se sigue devolviendo el pendiente sin descontar (`bruto`) y la pantalla lo
  muestra debajo de cada OF.

## Cifras al 9-oct (base real)
| Área | Antes | Ahora |
|---|---|---|
| CAMISA (con las generadas sin empezar) | 20.0 días | 18.4 días |
| PANTALON | 3.1 días | 2.8 días |
| SACO | 10.4 días | 6.4 días |

Con eso, lo que costura le entrega a ACABADO (≈4.6 mil min/día) queda cerca
de lo que ACABADO registra hacer (4.9 mil min/día con 14 presentes).

Rollback: `sql/parche_118_rollback.sql` (vuelve a la versión del 107).
