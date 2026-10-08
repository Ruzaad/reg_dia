-- Rollback del parche 111: quita la lectura de asistencia por confirmar.
drop function if exists public.fn_asistencia_por_confirmar(text, uuid, date, date);
