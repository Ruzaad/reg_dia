-- PARCHE 87 — Ingeniería · HORAS EXTRAS EN LOTE
-- El personal de un área en un día cualquiera, con su estado de ese día y las
-- horas extra que ya tiene registradas, para la sub-pestaña "Horas extras en
-- lote" de Incidencias. Solo lectura: el registro sigue siendo fn_ocurrencia
-- (tipo HORA_EXTRA), que ya salta a quien no estuvo activo ese día.
--
-- fn_personal no sirve aquí porque siempre mira el estado de HOY.

create or replace function public.fn_he_lote_personal(
  p_dni text, p_token uuid, p_area text, p_fecha date)
 returns json language plpgsql security definer
 set search_path to 'public'
as $function$
declare v json;
begin
  perform _ing(p_dni, p_token);
  if p_fecha is null then
    return json_build_object('ok', false, 'error', 'Elige el día');
  end if;

  select coalesce(json_agg(json_build_object(
           'dni', x.dni, 'nombre', x.nombre,
           'estado', coalesce(x.est, 'ACTIVO'),
           'ausente', coalesce(_ausente(x.est), false),
           'he_min', x.he_min)
           order by x.nombre), '[]'::json)
    into v
    from (select o.dni, o.nombres_apellidos nombre, _estado_dia(o.dni, p_fecha) est,
                 coalesce((select sum(oc.minutos) from ocurrencias oc
                            where oc.dni = o.dni and oc.fecha = p_fecha
                              and oc.tipo = 'HORA_EXTRA'), 0) he_min
            from operarios o
           where o.area_origen = p_area and o.estado = 'ACTIVO' and o.cargo = 'OPERARIO') x;

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
