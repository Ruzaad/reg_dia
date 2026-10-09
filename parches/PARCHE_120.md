# PARCHE 120 — Feriados y trabajo en sábado, domingo o feriado

## El problema
- No existía el feriado. El jueves 8-oct (Combate de Angamos) solo 5 personas
  registraron tickets: a las otras 159 el sistema les exigía 575 min y su día
  salía NO ENTREGÓ. A 87 de ellas eso solo les anulaba la quincena 1-15 oct.
- Quien trabaja en sábado o domingo recibía 575 min de disponible aunque haya
  ido 4 horas (26-set: 10 personas de SACO con 434 min en promedio). Nadie
  cargaba esas horas: 0 horas extra de fin de semana en 90 días.

## El cambio
- **Ingeniería › Tickets › Feriados y fin de semana.** Se marca un día completo
  como feriado (toda la planta) con su motivo, y se puede quitar.
  Lo hace quien edita todas las áreas.
- **Feriado**: no exige minutos, nadie sale NO ENTREGÓ ni "por confirmar",
  Boletas lo da por sin labor, Incentivos lo rotula FERIADO y no lo cuenta en
  el promedio del modular, igual que un sábado.
- **Sábado, domingo y feriado no tienen jornada (0 min)** desde el sábado
  10-oct-2026. Si alguien trabaja, Ingeniería **tiene que** poner sus horas:
  entran como HORA_EXTRA (detalle `JORNADA SABADO/DOMINGO/FERIADO`) y son su
  disponible del día. Se pueden poner antes ("¿Se trabaja este fin de
  semana?") o después. Quien registró tickets sin horas sale en rojo en la
  pantalla, con contador en el menú y aviso en el Inicio.
- La supervisora no ve el feriado como "ayer sin confirmar".

## Qué NO cambia
- Los fines de semana anteriores al 10-oct conservan sus 575 min: nada de lo
  ya calculado o pagado se mueve.
- Lunes a viernes sin feriado sigue igual (575 + incidencias).
- No toca `fn_carga_capacidad` (la corrige otro hilo); `_dias_hab` sí deja
  de contar feriados.

## Base de datos
- Tabla `feriados`; funciones `_feriado`, `_laborable`, `_jornada`.
- RPC nuevas: `fn_dias_no_laborables` (lectura, respeta áreas de Permisos),
  `fn_feriado_guardar`, `fn_jornada_horas_guardar` (solo áreas que edita).
- 20 funciones existentes cambian solo donde tenían 575 o "lunes a viernes"
  escritos a mano. El parche reescribe esos pedazos desde la definición viva,
  comprueba cada texto (si alguno no calza aborta sin tocar nada) y guarda la
  versión anterior en `parche_120_respaldo`, que usa el deshacer.
- Deshacer: `sql/parche_120_rollback.sql` (borra feriados y horas
  `JORNADA %`).
