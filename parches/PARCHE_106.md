# PARCHE 106 — Buscar y seguir una OF, una prenda o una persona

## El problema
Hay más de 30 cajas "Buscar" en Ingeniería y cada una filtra solo su pestaña.
Para saber quién tuvo un paquete hay que ir área por área a Tickets › Actual,
y no se puede buscar por número de prenda. Además el "paquete N" no es el
mismo en todas las operaciones por el troceo (126 de 131 OF por área).

## El cambio
- **Ingeniería › Tickets › Buscar y seguir.** Acepta OF, artículo, N° de
  prenda, `OF/prenda`, nombre o DNI. También se llega desde Ctrl+K: la
  primera opción es "Seguir «lo que escribiste»".
- **Ficha de paquete:** sigue la numeración por todas las operaciones de la
  BASE: registrada, nadie la registró, liberada y retomada, registrada otro
  día. "Lo que pasó" muestra solo lo que se sale de lo normal. Al tocar un
  módulo se ve quién y cuándo.
- **Ficha de OF:** avance por área y módulo, paquetes con hueco (abren su
  ficha), liberados por motivo y ACABADO por cantidad.
- **Ficha de persona:** sus últimos días, con lo registrado en otra fecha.
- **Supervisora:** Más › Buscar OF o prenda, solo de su área.

Solo lectura. Para liberar o mover se sigue usando Tickets › Actual.

### Base (`sql/parche_106.sql`)
- `fn_buscar`, `fn_traza_paquete`, `fn_traza_of`, `fn_traza_persona`: solo
  lectura, filtradas por las áreas de Permisos (la supervisora, su área). Lo
  ve todo usuario de oficina, sin casilla nueva en Permisos.
- Quién liberó o movió sale del Historial de cambios (parche 102). Antes del
  7-oct no se guardaba: la ficha dice "no se guardaba antes del 7-oct" y da un
  rango estimado entre el registro liberado y el que lo retomó.
- 5 índices nuevos (`reclamos (area, codigo)`, `reclamos (o_f)`,
  `reclamos (dni, fecha)`, `tickets_cache (o_f)` y `tickets_cambios_det (fila)`),
  unos 10 MB. Crearlos bloquea escrituras en esas tablas un par de segundos:
  mejor correrlo fuera de la hora punta (no después de las 6 pm).

Probado con una copia anonimizada: buscar "1350" 51 ms, ficha de paquete
29 ms, ficha de OF 107 ms. Rollback: `sql/parche_106_rollback.sql`.

Pendiente aparte (decisión 4 del preview): lista corta de motivos al liberar.
