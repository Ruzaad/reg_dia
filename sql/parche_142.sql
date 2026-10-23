-- PARCHE 142 — Eliminar un lote de REPROCESO
-- Solo se elimina un lote sin registros (ninguna cantidad cargada ni reclasificación).
-- Si ya tiene trabajo, se debe CERRAR (así no se pierde eficiencia ni historial).
-- Deja constancia en reproceso_lote_cambios (parche 141). Rollback: parche_142_rollback.sql
begin;

create or replace function public.fn_reproceso_lote_eliminar(p_dni text, p_token uuid, p_of text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; f ofs;
begin
  o := _auth(p_dni, p_token);
  if not _lote_permiso(o, 'REPROCESO', true) then raise exception 'NO_AUTORIZADA_AREA: no puedes eliminar lotes de REPROCESO'; end if;
  perform pg_advisory_xact_lock(hashtext('reproceso_lote:' || _nk(p_of)));
  select * into f from ofs where reproceso and _nk(o_f) = _nk(p_of);
  if not found then return json_build_object('ok', false, 'error', 'Ese lote no es de REPROCESO'); end if;
  if exists (select 1 from reclamos where _nk(o_f) = _nk(f.o_f) and area = 'REPROCESO')
     or exists (select 1 from reproceso_reclasif where _nk(o_f) = _nk(f.o_f)) then
    return json_build_object('ok', false, 'error', 'El lote ya tiene registros. Ciérralo en vez de eliminarlo.'); end if;
  insert into reproceso_lote_cambios (of_antes, of_despues, cant_antes, cant_despues, descuento, por)
  values (f.o_f, '(ELIMINADO)', f.cant_prog, 0, 0, o.dni);
  delete from ofs where o_f = f.o_f;
  return json_build_object('ok', true, 'of', f.o_f);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_lote_eliminar(text, uuid, text) to anon, authenticated;

commit;
