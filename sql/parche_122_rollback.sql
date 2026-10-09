-- ROLLBACK PARCHE 122 — vuelve _lote_area_hoy al parche 116.
begin;
create or replace function public._lote_area_hoy(o operarios)
 returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select case a.estado when 'EN DESPACHO' then 'DESPACHO' when 'EN REPROCESO' then 'REPROCESO' when 'EN CORTE' then 'CORTE' end
       from asistencia a where a.dni = o.dni and a.fecha = _hoy()
      order by a.creado desc limit 1),
    case when o.area_actual in ('CORTE','REPROCESO') then o.area_actual end)
$$;
revoke all on function public._lote_area_hoy(operarios) from public, anon, authenticated;
drop function if exists public.fn_lote_elegir_area(text, uuid, text);
drop table if exists public.lote_area_elegida;
commit;
