-- DESHACER PARCHE 163 — vuelve las 8 funciones a como estaban (guardadas en
-- parche_163_respaldo al correr el parche) y quita el conteo, los triggers, el
-- índice nuevo y los ajustes de limpieza automática. No toca datos de reclamos
-- ni de tickets_cache.

begin;

do $$
declare r record;
begin
  for r in select def from parche_163_respaldo loop
    execute r.def;
  end loop;
end $$;

drop trigger if exists oac_tc_ins on tickets_cache;
drop trigger if exists oac_tc_del on tickets_cache;
drop trigger if exists oac_tc_upd on tickets_cache;
drop trigger if exists oac_rc_ins on reclamos;
drop trigger if exists oac_rc_del on reclamos;
drop trigger if exists oac_rc_upd on reclamos;
drop function if exists _oac_tc_ins();
drop function if exists _oac_tc_del();
drop function if exists _oac_tc_upd();
drop function if exists _oac_rc_ins();
drop function if exists _oac_rc_del();
drop function if exists _oac_rc_upd();
drop function if exists _oac_recalcular();
drop table if exists of_area_conteo;
drop function if exists _tc_ficha(text, jsonb);
drop index if exists reclamos_sin_opid_art_idx;

alter table reclamos reset (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor,
                            autovacuum_vacuum_insert_scale_factor);
alter table tickets_cache reset (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor,
                                 autovacuum_vacuum_insert_scale_factor);

drop table parche_163_respaldo;

commit;
