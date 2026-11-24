-- Deshacer parche 186: quita la función de lectura del Asistente (el front vuelve al cálculo anterior).
begin;
drop function if exists public.fn_asistente_avance_of(text, uuid, text, integer);
commit;
