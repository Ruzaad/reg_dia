# PARCHE 107 — Carga vs capacidad por área

## El cambio
Ingeniería › Planificación › Carga vs capacidad ya estaba en qa esperando su
RPC. Con este parche calcula, por área de costura:
- **Minutos pendientes**: tickets generados que nadie reclamó, sin módulos
  cerrados. Se separan en OFs en curso, por empezar (vieja si se generó hace
  más de 3 semanas) y quietas.
- **Ritmo**: minutos reclamados por día, promedio de los últimos 10 días
  hábiles, sin los días con menos de la mitad de la mediana.
- **ACABADO**: cuánto le llega, según la BASE de cada artículo (STD de
  ACABADO ÷ STD de costura). Incluye su asistencia del último día marcado y
  los artículos sin BASE de ACABADO.
- CORTE, REPROCESO y UDP salen como "No medible", con su gente y la que está
  prestada ahí.
- También muestra las OF registradas hace más de 2 semanas que nunca
  generaron tickets.

Solo lectura y sin tablas nuevas. Se reparte por área en Gestión › Permisos
con la pestaña Carga vs capacidad. En la copia de prueba de la base tarda
alrededor de 1.2 s.

Rollback: `drop function public.fn_carga_capacidad(text, uuid, text);`
