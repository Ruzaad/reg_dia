-- Deshacer parche 172
begin;
drop function if exists public.fn_pcp_calendario(text, uuid, date);
drop function if exists public.fn_pcp_dia_cambiar(text, uuid, date, boolean, text);
drop function if exists public.fn_pcp_meta_mes_guardar(text, uuid, date, numeric, numeric);
drop function if exists public._habil(date);
create or replace function public.fn_pcp_meta_guardar(p_dni text, p_token uuid, p_mes date, p_metas jsonb)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_mes date := date_trunc('month', p_mes)::date; x jsonb; v_al text; v_ar text; v_m numeric; v_n int := 0;
begin
  o := _pcp_editor(p_dni, p_token);
  perform _perm_set(o);
  if v_mes is null or jsonb_typeof(p_metas) is distinct from 'array' then
    return json_build_object('ok', false, 'error', 'Faltan el mes o las metas');
  end if;
  for x in select * from jsonb_array_elements(p_metas) loop
    v_al := upper(trim(x->>'alcance'));
    v_ar := case when v_al = 'AREA' then nullif(upper(trim(x->>'area')), '') end;
    v_m := nullif(x->>'meta_minutos', '')::numeric;
    if v_al not in ('CORPORACION','AREA') or (v_al = 'AREA' and v_ar is null) then continue; end if;
    delete from metas_mes where mes = v_mes and alcance = v_al and area is not distinct from v_ar and dni is null;
    if coalesce(v_m, 0) > 0 then
      insert into metas_mes (mes, alcance, area, meta_minutos, cargado_por) values (v_mes, v_al, v_ar, round(v_m), o.dni);
    end if;
    v_n := v_n + 1;
  end loop;
  return json_build_object('ok', true, 'guardadas', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
-- dias_habilitados se conserva (no se borra sin confirmar). Para borrarla: drop table public.dias_habilitados;
commit;
