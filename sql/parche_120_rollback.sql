-- DESHACER PARCHE 120 — vuelve cada función a como estaba antes del parche
-- (desde parche_120_respaldo), quita las RPC nuevas, los feriados marcados y
-- las horas de sábado/domingo/feriado puestas con esta pantalla.
begin;

do $r$
declare c record;
begin
  for c in select firma, def from public.parche_120_respaldo loop
    execute c.def;
  end loop;
end $r$;

-- Sin el parche, esas horas se sumarían encima de los 575 del fin de semana.
delete from public.ocurrencias where tipo = 'HORA_EXTRA' and detalle like 'JORNADA %';

drop function if exists public.fn_dias_no_laborables(text, uuid, date, date);
drop function if exists public.fn_jornada_horas_guardar(text, uuid, date, numeric, text[]);
drop function if exists public.fn_regla_finde_guardar(text, uuid, date);
drop function if exists public.fn_feriado_guardar(text, uuid, date, text, boolean);
drop function if exists public._jornada(date);
drop function if exists public._laborable(date);
drop function if exists public._feriado(date);
drop table if exists public.feriados;
drop table if exists public.regla_finde;
drop table if exists public.parche_120_respaldo;

commit;
