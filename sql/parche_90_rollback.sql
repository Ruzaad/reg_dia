-- ROLLBACK PARCHE 90 — vuelve a repartir los 575 min solo por la hora del movimiento.
-- Basta con restaurar las dos funciones de reparto. La columna `origen`, la
-- tabla `area_hora_declarada`, `fn_area_declarar_hora` y `_disp_reparto` pueden
-- quedarse: sin estas dos nadie reparte con ellas y la app sigue funcionando.

create or replace function public._disp_prorrateado(p_dni text, p_area text, p_fecha date)
 returns numeric language plpgsql stable set search_path to 'public'
as $function$
declare
  v_inicio timestamptz := (p_fecha::text || ' 08:00')::timestamp at time zone 'America/Lima';
  v_fin    timestamptz := (p_fecha::text || ' 18:20')::timestamp at time zone 'America/Lima';
  v_total_bruto    numeric := 620;
  v_total_efectivo numeric := 575;
  v_mov record;
  v_desde timestamptz;
  v_min_area numeric := 0;
  v_area_actual text;
begin
  if extract(dow from p_fecha) in (0, 6) then
    if not exists (select 1 from reclamos
                   where dni = p_dni and fecha = p_fecha and estado = 'ACTIVO') then
      return 0;
    end if;
  end if;

  if not exists (select 1 from movimientos_area where dni = p_dni and fecha = p_fecha) then
    select area_actual into v_area_actual from operarios where dni = p_dni;
    if v_area_actual = p_area then return v_total_efectivo; else return 0; end if;
  end if;

  v_desde := v_inicio;
  for v_mov in
    select area_anterior, area_nueva, creado
    from movimientos_area
    where dni = p_dni and fecha = p_fecha
    order by creado
  loop
    if v_mov.creado > v_desde and v_mov.area_anterior = p_area then
      v_min_area := v_min_area + extract(epoch from (least(v_mov.creado, v_fin) - v_desde)) / 60.0;
    end if;
    v_desde := greatest(v_desde, least(v_mov.creado, v_fin));
  end loop;

  select area_nueva into v_area_actual
  from movimientos_area where dni = p_dni and fecha = p_fecha
  order by creado desc limit 1;

  if v_area_actual = p_area and v_fin > v_desde then
    v_min_area := v_min_area + extract(epoch from (v_fin - v_desde)) / 60.0;
  end if;

  if v_min_area <= 0 then return 0; end if;
  return round(least(v_min_area, v_total_bruto) / v_total_bruto * v_total_efectivo, 1);
end $function$;

create or replace function public._disp_dia_areas(p_fecha date)
 returns table(dni text, area text, minutos numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  with lim as (
    select (p_fecha::text || ' 08:00')::timestamp at time zone 'America/Lima' ini,
           (p_fecha::text || ' 18:20')::timestamp at time zone 'America/Lima' fin,
           620::numeric bruto, 575::numeric efectivo,
           extract(dow from p_fecha) in (0,6) finde
  ),
  gente as (
    select o.dni, o.area_actual
    from operarios o
    where o.cargo = 'OPERARIO' and o.estado = 'ACTIVO'
  ),
  produjo as (
    select distinct r.dni from reclamos r
    where r.fecha = p_fecha and r.estado = 'ACTIVO'
  ),
  habiles as (
    select g.* from gente g cross join lim l
    where not l.finde or exists (select 1 from produjo p where p.dni = g.dni)
  ),
  mov as (
    select m.dni, m.area_anterior, m.area_nueva,
           least(greatest(m.creado, l.ini), l.fin) t,
           row_number() over (partition by m.dni order by m.creado) rn,
           count(*)     over (partition by m.dni) n
    from movimientos_area m
    cross join lim l
    where m.fecha = p_fecha
      and m.dni in (select dni from habiles)
  ),
  tramos as (
    select m.dni, m.area_anterior area,
           coalesce(lag(m.t) over (partition by m.dni order by m.rn), l.ini) desde,
           m.t hasta
    from mov m cross join lim l
    union all
    select m.dni, m.area_nueva, m.t, l.fin
    from mov m cross join lim l
    where m.rn = m.n
  ),
  con_mov as (
    select t.dni, t.area,
           sum(greatest(0, extract(epoch from (t.hasta - t.desde)) / 60.0)) bruto
    from tramos t
    where t.area is not null
    group by 1,2
  )
  select c.dni, c.area,
         round(least(c.bruto, l.bruto) / l.bruto * l.efectivo, 1)
    from con_mov c cross join lim l
   where c.bruto > 0
  union all
  select h.dni, h.area_actual, l.efectivo
    from habiles h cross join lim l
   where h.area_actual is not null
     and not exists (select 1 from mov m where m.dni = h.dni);
$function$;
