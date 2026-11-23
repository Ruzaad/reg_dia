-- ROLLBACK PARCHE 177: vuelve a fn_inicio_mes del parche 149 (siempre calcula con _pcp_prod).
begin;

CREATE OR REPLACE FUNCTION public.fn_inicio_mes(p_dni text, p_token uuid, p_fecha date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
declare v_f date := coalesce(p_fecha, _hoy()); v_mes date := date_trunc('month', coalesce(p_fecha, _hoy()))::date; v_h date := coalesce(p_fecha, _hoy()) - 1;
begin
  perform _lector(p_dni, p_token, '');
  if v_h >= v_mes and not exists (select 1 from inicio_mes_cache where mes = v_mes and hasta = v_h and creado = current_date) then
    delete from inicio_mes_cache where (mes = v_mes and hasta = v_h) or creado < current_date - 3;
    insert into inicio_mes_cache (mes, hasta, area, minutos)
      select v_mes, v_h, area, round(sum(minutos)) from _pcp_prod(v_mes, v_h) group by area
      union all select v_mes, v_h, '', 0;
  end if;
  return json_build_object('ok', true, 'mes', v_mes,
    'meta_mes', coalesce((select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION'), (select sum(meta_minutos) from metas_mes where mes = v_mes and alcance = 'AREA')),
    'areas', coalesce((select json_agg(json_build_object('area', a.area, 'acum', a.acum, 'meta', m.meta_minutos))
       from (select area, sum(minutos) acum from inicio_mes_cache where mes = v_mes and hasta = v_h and area <> '' group by area) a
       left join metas_mes m on m.mes = v_mes and m.alcance = 'AREA' and m.area = a.area), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
