-- PARCHE 99 · Usuarios de oficina (COSTOS u otro cargo) con usuario en vez de DNI
-- El check solo dejaba un usuario no numérico (LFABIAN, ALOPEZ…) si el cargo era
-- INGENIERIA. El parche 95 abrió la oficina a otros cargos (COSTOS), así que crear
-- "vbendita" como COSTOS fallaba con operarios_dni_check. Ahora: operario,
-- estajero y supervisora siguen con DNI de 8 dígitos; cualquier otro cargo puede
-- usar un usuario. Idempotente.

alter table public.operarios drop constraint if exists operarios_dni_check;
alter table public.operarios add constraint operarios_dni_check
  check (dni ~ '^[0-9]{8}$' or cargo not in ('OPERARIO','ESTAJERO','SUPERVISORA'));
