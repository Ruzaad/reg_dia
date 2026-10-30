-- Vuelve a la fn_inicio_plan del parche 154 y borra la tabla nueva.
begin;
drop table if exists public.inicio_mes_cerrado;
commit;
-- Después vuelve a correr sql/parche_154.sql (su create or replace deja la función anterior).
