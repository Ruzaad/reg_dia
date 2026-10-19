begin;
drop function if exists public.fn_sup_horas_fecha(text, uuid, date, numeric, text[]);
create or replace function public.fn_sup_he_lista(p_dni text, p_token uuid, p_area text, p_fecha date)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
 set statement_timeout to '15s'
as $function$
declare s operarios; v_area text; v_items json; v_ult date; v_ult_min numeric; v_ult_dnis json;
begin
  s := _auth(p_dni, p_token);
  if s.cargo = 'SUPERVISORA' then v_area := s.area_actual;
  elsif s.cargo = 'INGENIERIA' then perform _lector(p_dni, p_token, p_area); v_area := p_area;
  else raise exception 'NO_AUTORIZADA'; end if;
  if p_fecha is null then return json_build_object('ok', false, 'error', 'Elige el día'); end if;

  select coalesce(json_agg(json_build_object(
           'dni', x.dni, 'nombre', x.nombre,
           'estado', coalesce(x.est, 'ACTIVO'),
           'ausente', coalesce(_ausente(x.est), false),
           'he_min', x.he_min, 'tickets', x.tk) order by x.nombre), '[]'::json)
    into v_items
    from (select o.dni, o.nombres_apellidos nombre, _estado_dia(o.dni, p_fecha) est,
                 coalesce((select sum(oc.minutos) from ocurrencias oc
                            where oc.dni = o.dni and oc.fecha = p_fecha and oc.tipo = 'HORA_EXTRA'), 0) he_min,
                 (select count(*) from reclamos r
                   where r.dni = o.dni and r.fecha = p_fecha and r.estado = 'ACTIVO') tk
            from operarios o
           where o.area_origen = v_area and o.estado = 'ACTIVO' and o.cargo = 'OPERARIO') x;

  -- Última vez que hubo horas extra en el área antes de ese día.
  select max(oc.fecha) into v_ult
    from ocurrencias oc join operarios o on o.dni = oc.dni
   where oc.tipo = 'HORA_EXTRA' and oc.fecha < p_fecha and oc.fecha >= p_fecha - 60
     and o.area_origen = v_area;
  if v_ult is not null then
    select json_agg(distinct oc.dni), max(oc.minutos) into v_ult_dnis, v_ult_min
      from ocurrencias oc join operarios o on o.dni = oc.dni
     where oc.tipo = 'HORA_EXTRA' and oc.fecha = v_ult and o.area_origen = v_area;
  end if;

  return json_build_object('ok', true, 'area', v_area, 'fecha', to_char(p_fecha,'YYYY-MM-DD'),
    'hoy', to_char(_hoy(),'YYYY-MM-DD'), 'items', v_items,
    'ultima', case when v_ult is null then null else json_build_object(
      'fecha', to_char(v_ult,'YYYY-MM-DD'), 'minutos', v_ult_min, 'dnis', v_ult_dnis) end);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_sup_he_lista(text, uuid, text, date) to anon, authenticated;
commit;
