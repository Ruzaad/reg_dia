-- ROLLBACK PARCHE 97 · Quita los estados "EN <área>".
-- Los días ya marcados con "EN <área>" pasan a ACTIVO: la persona sí estuvo en planta.

begin;

-- Definición anterior (tal como estaba antes del parche 97).
create or replace function public.fn_asistencia_areas(p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v json;
begin
  perform _ing(p_dni, p_token);
  if p_hasta < p_desde then return json_build_object('ok',false,'error','Rango inválido'); end if;
  if (p_hasta - p_desde) > 366 then return json_build_object('ok',false,'error','Rango máximo 366 días'); end if;

  with areas as (
    select area_actual area, count(*) estructura
    from operarios where cargo='OPERARIO' and estado='ACTIVO'
    group by area_actual
  ),
  dias as (
    select d::date f from generate_series(p_desde,p_hasta,interval '1 day') d
    where extract(dow from d) not in (0,6)
  ),
  est as (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
        row_number() over (partition by a.dni,a.fecha order by a.creado desc) rn
      from asistencia a where a.fecha between p_desde and p_hasta
    ) z where rn=1
  ),
  cont as (
    select o.area_actual area, dd.f,
      count(*) filter (where e.estado = 'ACTIVO') activos,
      count(*) filter (where e.estado is not null and e.estado <> 'ACTIVO' and e.estado <> 'FALTA') excus
    from operarios o
    cross join dias dd
    left join est e on e.dni=o.dni and e.fecha=dd.f
    where o.cargo='OPERARIO' and o.estado='ACTIVO'
    group by o.area_actual, dd.f
  ),
  pct as (
    select c.area, avg( case when (a.estructura - c.excus) > 0
                             then c.activos::numeric/(a.estructura - c.excus)*100 end ) p
    from cont c join areas a on a.area=c.area
    group by c.area
  )
  select coalesce(json_agg(json_build_object(
      'area', a.area, 'estructura', a.estructura,
      'pct', round(coalesce(p.p,0),1)) order by a.area), '[]'::json)
    into v
  from areas a left join pct p on p.area=a.area;

  return json_build_object('ok', true, 'areas', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Definición anterior (tal como estaba antes del parche 97).
create or replace function public.fn_asistencia_dashboard(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
  v_personal int; v_lab int; v_hoy_pres int := 0;
  v_pordia json; v_porestado json; v_alertas json; v_detalle json;
  hoy date := _hoy();
begin
  perform _ing(p_dni, p_token);
  if p_hasta < p_desde then return json_build_object('ok',false,'error','Rango inválido'); end if;
  if (p_hasta - p_desde) > 366 then return json_build_object('ok',false,'error','Rango máximo 366 días'); end if;

  select count(*) into v_personal from operarios o
   where o.cargo='OPERARIO' and o.estado='ACTIVO' and (coalesce(p_area,'')='' or o.area_actual=p_area);
  select count(*) into v_lab from generate_series(p_desde,p_hasta,interval '1 day') d
   where extract(dow from d) not in (0,6);

  with gente as (
    select dni from operarios where cargo='OPERARIO' and estado='ACTIVO'
      and (coalesce(p_area,'')='' or area_actual=p_area)
  ),
  dias as (
    select d::date f from generate_series(p_desde,p_hasta,interval '1 day') d
    where extract(dow from d) not in (0,6)
  ),
  est as (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
        row_number() over (partition by a.dni,a.fecha order by a.creado desc) rn
      from asistencia a
      where a.fecha between p_desde and p_hasta and a.dni in (select dni from gente)
    ) z where rn=1 and estado <> 'ACTIVO'
  ),
  aus as (
    select dd.f, count(distinct e.dni) n
    from dias dd left join est e on e.fecha = dd.f
    group by dd.f
  )
  select coalesce(json_agg(json_build_object(
      'fecha', to_char(f,'YYYY-MM-DD'),
      'presentes', greatest(v_personal - n, 0),
      'ausentes', n) order by f), '[]'::json)
    into v_pordia from aus;

  with gente as (
    select dni from operarios where cargo='OPERARIO' and estado='ACTIVO'
      and (coalesce(p_area,'')='' or area_actual=p_area)
  ),
  dias as (
    select d::date f from generate_series(p_desde,p_hasta,interval '1 day') d
    where extract(dow from d) not in (0,6)
  ),
  est as (
    select z.dni, z.estado from (
      select a.dni, a.fecha, a.estado,
        row_number() over (partition by a.dni,a.fecha order by a.creado desc) rn
      from asistencia a
      where a.fecha between p_desde and p_hasta and a.dni in (select dni from gente)
    ) z join dias dd on dd.f = z.fecha where z.rn=1 and z.estado <> 'ACTIVO'
  ),
  peor as ( select dni, estado, count(*) c from est group by dni, estado ),
  pres as ( select g.dni, greatest(v_lab - coalesce((select sum(c) from peor p where p.dni=g.dni),0),0) c from gente g ),
  allrows as (
    select o.nombres_apellidos nombre, p.estado, p.c from peor p join operarios o on o.dni=p.dni
    union all
    select o.nombres_apellidos nombre, 'ACTIVO' estado, pr.c from pres pr join operarios o on o.dni=pr.dni where pr.c>0
  )
  select coalesce((select json_object_agg(estado, arr) from (
           select estado, json_agg(json_build_object('nombre',nombre,'veces',c) order by c desc, nombre) arr
           from allrows group by estado) u), '{}'::json),
         coalesce((select json_object_agg(estado, tot) from (
           select estado, sum(c) tot from allrows group by estado) v), '{}'::json)
    into v_detalle, v_porestado;

  if extract(dow from hoy) not in (0,6) then
    select v_personal - count(distinct z.dni) into v_hoy_pres
    from (
      select a.dni, a.estado, row_number() over (partition by a.dni order by a.creado desc) rn
      from asistencia a
      where a.fecha = hoy and a.estado <> 'ACTIVO'
        and a.dni in (select dni from operarios where cargo='OPERARIO' and estado='ACTIVO'
                      and (coalesce(p_area,'')='' or area_actual=p_area))
    ) z where z.rn=1;
  else v_hoy_pres := 0; end if;

  select coalesce(json_agg(json_build_object(
      'fecha', to_char(e.fecha,'YYYY-MM-DD'), 'nombre', o.nombres_apellidos, 'estado', e.estado)
      order by e.fecha desc, o.nombres_apellidos), '[]'::json)
    into v_alertas
  from (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
        row_number() over (partition by a.dni,a.fecha order by a.creado desc) rn
      from asistencia a
      where a.fecha between greatest(p_desde, p_hasta - 6) and p_hasta
        and a.dni in (select dni from operarios where cargo='OPERARIO' and estado='ACTIVO'
                      and (coalesce(p_area,'')='' or area_actual=p_area))
    ) z where rn=1 and estado <> 'ACTIVO'
  ) e join operarios o on o.dni = e.dni;

  return json_build_object('ok', true,
    'personal', v_personal, 'dias_laborales', v_lab,
    'hoy_presentes', greatest(v_hoy_pres,0), 'hoy_total', v_personal,
    'por_dia', v_pordia, 'por_estado', coalesce(v_porestado,'{}'::json),
    'detalle', coalesce(v_detalle,'{}'::json), 'alertas', v_alertas);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;


update asistencia set estado = 'ACTIVO' where estado like 'EN %';
delete from estados_asistencia where nombre like 'EN %';
drop function if exists public._presente(text);

commit;
