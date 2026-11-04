-- DESHACER PARCHE 166 — vuelve _boleta_estados y _pcp_prod a como estaban
-- (guardadas en parche_166_respaldo al correr el parche). No toca datos.

begin;

do $$
declare r record;
begin
  for r in select def from parche_166_respaldo loop
    execute r.def;
  end loop;
end $$;

drop table parche_166_respaldo;

commit;
