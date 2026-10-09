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
- **Regla de fin de semana, apagada al correr el parche.** Mientras esté
  apagada, sábado y domingo siguen con 575 como siempre. Quien edita todas
  las áreas la prende desde la pantalla con la fecha en que empieza (no puede
  ser más de 7 días atrás). Desde esa fecha, sábado y domingo no tienen
  jornada (0 min), igual que el feriado. Si alguien trabaja, Ingeniería
  **tiene que** poner sus horas:
  entran como HORA_EXTRA (detalle `JORNADA SABADO/DOMINGO/FERIADO`) y son su
  disponible del día. Se pueden poner antes ("¿Se trabaja este fin de
  semana?") o después. Quien registró tickets sin horas sale en rojo en la
  pantalla, con contador en el menú y aviso en el Inicio.
- La supervisora no ve el feriado como "ayer sin confirmar".

## Qué NO cambia
- Con la regla apagada, ningún fin de semana cambia. Prenderla solo cuando
  esta pantalla ya esté en producción: si no, nadie tendría dónde poner las
  horas. Apagarla borra las horas `JORNADA SABADO/DOMINGO` de los días que
  vuelven a tener 575.
- Lunes a viernes sin feriado sigue igual (575 + incidencias).
- No toca `fn_carga_capacidad` (la corrige otro hilo; su ritmo ya descarta
  días flojos como un feriado), ni `fn_avance_modulos`, `fn_ef_auditoria`
  (la vieja), `fn_reprocesos_apoyo` y `fn_solicitud_ajuste_crear`: los dos
  primeros no los llama la app y los otros usan 575 como tope, no como
  jornada. `_dias_hab` sí deja de contar feriados.

## Base de datos
- Tablas `feriados` y `regla_finde` (una fila, `desde` vacío = apagada); funciones `_feriado`, `_laborable`, `_jornada`.
- RPC nuevas: `fn_dias_no_laborables` (lectura, respeta áreas de Permisos),
  `fn_feriado_guardar`, `fn_regla_finde_guardar`, `fn_jornada_horas_guardar` (solo áreas que edita).
- 20 funciones existentes cambian solo donde tenían 575 o "lunes a viernes"
  escritos a mano. El parche reescribe esos pedazos desde la definición viva,
  comprueba cada texto (si alguno no calza aborta sin tocar nada) y guarda la
  versión anterior en `parche_120_respaldo`, que usa el deshacer.
- Deshacer: `sql/parche_120_rollback.sql` (borra feriados y horas
  `JORNADA %`).
