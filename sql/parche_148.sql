-- PARCHE 148 — Inicio de Ingeniería: prendas registradas del día
-- fn_inicio_prendas(fecha): prendas por área de un día, contadas por la PENÚLTIMA operación del artículo (_pcp_prod, parche 147).
-- Necesita el parche 147. Solo lectura, una sola fecha (mide < 1 s). No se toca ninguna RPC existente.
-- Rollback: parche_148_rollback.sql
begin;

create or replace function public.fn_inicio_prendas(p_dni text, p_token uuid, p_fecha date default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare v_f date := coalesce(p_fecha, _hoy());
begin
  perform _lector(p_dni, p_token, '');
  return json_build_object('ok', true, 'fecha', v_f,
    'areas', coalesce((select json_agg(json_build_object('area', area, 'prendas', round(prendas))) from _pcp_prod(v_f, v_f) where prendas > 0), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
