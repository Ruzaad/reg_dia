-- Deshacer parche 169: vuelve fn_solicitudes_panel a la versión del parche 114.
begin;

create or replace function public.fn_solicitudes_panel(p_dni text, p_token uuid, p_area text, p_dias integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare quien operarios; v_areas text[]; res json; v_ap json;
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  v_areas := _sol_areas(quien);

  select coalesce(json_agg(x order by x->>'estado' <> 'PENDIENTE', x->>'area', (x->>'id')::bigint), '[]'::json) into res
  from (
    select json_build_object(
      'id', sa.id, 'dni', sa.dni, 'nombre', o.nombres_apellidos, 'cat', o.categoria, 'area', sa.area,
      'fecha', to_char(sa.fecha,'YYYY-MM-DD'), 'minutos', sa.minutos, 'minutos_final', sa.minutos_final,
      'motivo', sa.motivo, 'tipo', sa.tipo, 'estado', sa.estado,
      'pidio', to_char(sa.creado at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'solicitante', so.nombres_apellidos, 'solo_ing', coalesce(sa.solo_ingenieria,false),
      'area_trabajo', sa.area_trabajo, 'area_causa', sa.area_causa, 'o_f', sa.o_f,
      'visto_bueno', vb.nombres_apellidos,
      'visto_bueno_en', to_char(sa.visto_bueno_en at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'resuelto_por', rp.nombres_apellidos, 'resuelto_dni', sa.resuelto_por,
      'resuelto_en', to_char(sa.resuelto_en at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'motivo_rechazo', sa.motivo_rechazo,
      'chica', _sol_chica(sa.tipo, sa.minutos),
      'aprueba', case when quien.cargo = 'SUPERVISORA' then _sol_chica(sa.tipo, sa.minutos) and not coalesce(sa.solo_ingenieria,false)
                      else _aprueba(quien, sa.area) end,
      'reg', d.reg, 'inc', d.inc, 'he', d.he, 'pide', d.pide,
      'rep', (select json_build_object('id', s2.id, 'estado', s2.estado,
                       'hora', to_char(s2.creado at time zone 'America/Lima','HH24:MI'))
                from solicitudes_ajuste s2
               where sa.estado = 'PENDIENTE' and s2.id <> sa.id and s2.dni = sa.dni and s2.fecha = sa.fecha
                 and s2.minutos = sa.minutos and s2.tipo is not distinct from sa.tipo
                 and s2.motivo is not distinct from sa.motivo
                 and (s2.estado = 'APROBADO' or (s2.estado = 'PENDIENTE' and s2.id < sa.id))
               order by s2.estado = 'APROBADO' desc, s2.id limit 1),
      'igual', (select json_build_object('id', oc.id, 'por', coalesce(r2.nombres_apellidos, oc.supervisora_dni))
                  from ocurrencias oc left join operarios r2 on r2.dni = oc.supervisora_dni
                 where sa.estado = 'PENDIENTE' and oc.dni = sa.dni and oc.fecha = sa.fecha
                   and oc.tipo = sa.tipo and oc.minutos = sa.minutos and oc.solicitud_id is null
                 limit 1)) x
    from solicitudes_ajuste sa
    join operarios o on o.dni = sa.dni
    left join operarios so on so.dni = sa.solicitante_dni
    left join operarios vb on vb.dni = sa.visto_bueno_por
    left join operarios rp on rp.dni = sa.resuelto_por
    left join lateral (
      select (select coalesce(round(sum(r.minutos)),0) from reclamos r
               where r.dni = sa.dni and r.fecha = sa.fecha and r.estado = 'ACTIVO') reg,
             (select coalesce(sum(-oc.minutos) filter (where oc.minutos < 0),0) from ocurrencias oc
               where oc.dni = sa.dni and oc.fecha = sa.fecha) inc,
             (select coalesce(sum(oc.minutos) filter (where oc.minutos > 0),0) from ocurrencias oc
               where oc.dni = sa.dni and oc.fecha = sa.fecha) he,
             (select coalesce(sum(-s3.minutos) filter (where s3.minutos < 0),0) from solicitudes_ajuste s3
               where s3.dni = sa.dni and s3.fecha = sa.fecha and s3.estado = 'PENDIENTE') pide
      where sa.estado = 'PENDIENTE') d on true
    where (v_areas is null or sa.area = any(v_areas))
      and (nullif(p_area,'') is null or quien.cargo = 'SUPERVISORA' or sa.area = p_area)
      and (quien.cargo = 'INGENIERIA' or not coalesce(sa.solo_ingenieria,false))
      and (sa.estado = 'PENDIENTE'
           or (coalesce(p_dias,0) > 0 and sa.resuelto_en > now() - make_interval(days => least(p_dias, 31))))
  ) t;

  return json_build_object('ok', true, 'items', res,
    'cargo', quien.cargo, 'admin', coalesce(quien.es_admin,false));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
