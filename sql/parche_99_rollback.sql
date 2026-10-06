-- ROLLBACK PARCHE 99 · vuelve el check anterior (usuario no numérico solo para INGENIERIA).
-- Falla si ya hay un usuario de COSTOS con usuario no numérico: hay que cambiarle el
-- cargo o el DNI antes.
alter table public.operarios drop constraint if exists operarios_dni_check;
alter table public.operarios add constraint operarios_dni_check
  check (dni ~ '^[0-9]{8}$' or cargo = 'INGENIERIA');
