-- PARCHE 97 · Asistencia: variables "EN <área>" (personal presente apoyando en otra área)
-- Ver parches/PARCHE_97.md. Idempotente: se puede correr más de una vez.
-- Requiere el parche 95 (permisos por área): estas dos funciones validan con
-- _lector, como las dejó el 95. Antes usaban _ing y, corridas después del 95,
-- habrían quitado el permiso por área en Asistencia.

begin;

-- 1) Los nueve estados nuevos. Todos empiezan con "EN ": así los reconoce la app.
insert into estados_asistencia (nombre) values
  ('EN ACABADO'), ('EN SASTRERIA (UDP)'), ('EN CAMISAS'), ('EN SACOS'), ('EN PANTALON'),
  ('EN REPROCESO'), ('EN DESPACHO'), ('EN ALMACEN'), ('EN CORTE')
on conflict (nombre) do nothing;

-- 2) ¿Estuvo en planta? ACTIVO o en otra área. `_ausente` NO cambia: para la
--    eficiencia de su área de origen, quien está en otra área no tiene minutos
--    exigidos (igual que hoy con una incidencia de 575 min por Despacho).
create or replace function public._presente(p_estado text)
returns boolean language sql immutable
as $$ select coalesce(p_estado,'ACTIVO') = 'ACTIVO' or p_estado like 'EN %' $$;

-- 3) % de asistencia por área: "EN <área>" cuenta como asistió, no como excusado.
create or replace function public.fn_asistencia_areas(p_dni text, p_token uuid, p_desde date, p_hasta date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare v json;
begin
  perform _lector(p_dni, p_token, '');
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
      count(*) filter (where e.estado is not null and _presente(e.estado)) activos,
      count(*) filter (where e.estado is not null and not _presente(e.estado) and e.estado <> 'FALTA') excus
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

-- 4) Tablero de asistencia: "EN <área>" suma a presentes, no sale en alertas y
--    se cuenta aparte (hoy_otra_area, clave nueva: el front viejo la ignora).
create or replace function public.fn_asistencia_dashboard(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
  v_personal int; v_lab int; v_hoy_pres int := 0; v_hoy_otra int := 0;
  v_pordia json; v_porestado json; v_alertas json; v_detalle json;
  hoy date := _hoy();
begin
  perform _lector(p_dni, p_token, p_area);
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
    ) z where rn=1 and not _presente(estado)
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
    select v_personal - count(distinct z.dni) filter (where not _presente(z.estado)),
           count(distinct z.dni) filter (where z.estado like 'EN %')
      into v_hoy_pres, v_hoy_otra
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
    ) z where rn=1 and not _presente(estado)
  ) e join operarios o on o.dni = e.dni;

  return json_build_object('ok', true,
    'personal', v_personal, 'dias_laborales', v_lab,
    'hoy_presentes', greatest(v_hoy_pres,0), 'hoy_total', v_personal,
    'hoy_otra_area', coalesce(v_hoy_otra,0),
    'por_dia', v_pordia, 'por_estado', coalesce(v_porestado,'{}'::json),
    'detalle', coalesce(v_detalle,'{}'::json), 'alertas', v_alertas);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;

-- Verificación (debe dar 15 estados, 9 que empiezan con "EN "):
-- select count(*), count(*) filter (where nombre like 'EN %') from estados_asistencia;
