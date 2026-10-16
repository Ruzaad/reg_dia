-- Deshace el parche 130: vuelve fn_asistencia_matriz a la versión anterior (sin 'no_lab'),
-- borra fn_asistencia_celdas y la tabla metas_mes (si PCP ya cargó metas, se pierden: revisar antes).
begin;

drop function if exists public.fn_asistencia_celdas(text, text, jsonb, text);

create or replace function public.fn_asistencia_matriz(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_dias json; v_personal json;
begin
  perform _lector(p_dni, p_token, p_area);
  if p_hasta < p_desde then return json_build_object('ok',false,'error','Rango inválido'); end if;
  if (p_hasta - p_desde) > 62 then return json_build_object('ok',false,'error','Rango máximo 62 días'); end if;

  select json_agg(to_char(d,'YYYY-MM-DD') order by d) into v_dias
  from generate_series(p_desde,p_hasta,interval '1 day') d;

  with est as (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
        row_number() over (partition by a.dni,a.fecha order by a.creado desc) rn
      from asistencia a where a.fecha between p_desde and p_hasta
    ) z where rn=1
  )
  select json_agg(json_build_object(
      'dni', o.dni, 'nombre', o.nombres_apellidos, 'area', o.area_actual,
      'registros', coalesce((select json_object_agg(to_char(e.fecha,'YYYY-MM-DD'), e.estado)
                             from est e where e.dni = o.dni), '{}'::json))
      order by o.area_actual, o.nombres_apellidos) into v_personal
  from operarios o
  where o.cargo='OPERARIO' and o.estado='ACTIVO' and (coalesce(p_area,'')='' or o.area_actual=p_area);

  return json_build_object('ok', true, 'dias', coalesce(v_dias,'[]'::json), 'personal', coalesce(v_personal,'[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

drop table if exists public.metas_mes;

commit;
