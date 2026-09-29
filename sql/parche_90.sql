-- PARCHE 90 — Personal que cambia de área en el día
-- Los 575 min del día se repartían entre áreas con la HORA del movimiento, y
-- esa hora casi nunca es real: el movimiento lo crea el trigger del reclamo
-- (parche 58) en el momento en que el operario REGISTRA, que suele ser al
-- almuerzo o a las 18:20. Quien llena a las 18:20 tickets de saco y luego de
-- pantalón queda con 575 en saco y 0 en pantalón.
--
-- Ahora:
--   · cada movimiento guarda su ORIGEN: RECLAMO (hora de registro, no fiable),
--     DECLARADO (el operario dijo desde qué hora), MANUAL (supervisora o
--     ingeniería lo movieron) o AJUSTADO (ingeniería corrigió la hora);
--   · el operario, al cambiar de área en la app, dice desde qué hora está ahí;
--   · si el día tiene algún movimiento no fiable (o produjo en varias áreas sin
--     movimiento), los 575 se reparten en proporción a los minutos producidos
--     en cada área. Si todos son fiables, se reparte por reloj como antes.
-- La eficiencia del día (575 + incidencias) no cambia: solo el reparto por área.

-- 1. Origen del movimiento ---------------------------------------------------
alter table public.movimientos_area add column if not exists origen text;
update public.movimientos_area
   set origen = case when movido_por <> dni then 'MANUAL'
                     when date_trunc('minute', creado) = creado then 'AJUSTADO'  -- fn_movimiento_hora deja HH:MI:00
                     else 'RECLAMO' end
 where origen is null;
alter table public.movimientos_area alter column origen set default 'RECLAMO';
create index if not exists movimientos_area_fecha_dni on public.movimientos_area (fecha, dni);

-- 2. Hora declarada antes de reclamar ----------------------------------------
-- El operario elige el área (y la hora) antes de reclamar; el movimiento lo
-- crea el trigger al primer reclamo y ahí se consume la declaración.
create table if not exists public.area_hora_declarada (
  dni text not null, fecha date not null, area text not null, hora time not null,
  creado timestamptz not null default now(),
  primary key (dni, fecha, area));
alter table public.area_hora_declarada enable row level security;
revoke all on public.area_hora_declarada from anon, authenticated;

create or replace function public.fn_area_declarar_hora(p_dni text, p_token uuid, p_area text, p_hora time)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; v_ts timestamptz; m movimientos_area; v_prev timestamptz;
begin
  s := _auth(p_dni, p_token);
  if coalesce(trim(p_area),'') = '' then return json_build_object('ok',false,'error','Indica el área'); end if;
  if p_hora is null then return json_build_object('ok',false,'error','Indica la hora'); end if;
  v_ts := (_hoy()::text || ' ' || to_char(p_hora,'HH24:MI'))::timestamp at time zone 'America/Lima';
  if v_ts > now() + interval '2 minutes' then
    return json_build_object('ok',false,'error','La hora no puede ser posterior a ahora'); end if;

  delete from area_hora_declarada where fecha < _hoy();

  /* Ya lo movió un reclamo hoy: se corrige ese movimiento. */
  if s.area_actual = p_area then
    select mm.* into m from movimientos_area mm
     where mm.dni = s.dni and mm.fecha = _hoy() and mm.area_nueva = p_area
       and mm.origen in ('RECLAMO','DECLARADO')
       and not exists (select 1 from movimientos_area x
                        where x.dni = s.dni and x.fecha = _hoy() and x.creado > mm.creado)
     limit 1;
    if not found then return json_build_object('ok', true, 'aplicado', false); end if;
    select max(creado) into v_prev from movimientos_area
     where dni = s.dni and fecha = _hoy() and id <> m.id and creado <= m.creado;
    if v_prev is not null and v_ts < v_prev then
      return json_build_object('ok',false,'error',
        'Tu cambio anterior fue a las '||to_char(v_prev at time zone 'America/Lima','HH24:MI')||'; la hora debe ser posterior'); end if;
    update movimientos_area set creado = v_ts, origen = 'DECLARADO' where id = m.id;
    return json_build_object('ok', true, 'aplicado', true);
  end if;

  select max(creado) into v_prev from movimientos_area where dni = s.dni and fecha = _hoy();
  if v_prev is not null and v_ts < v_prev then
    return json_build_object('ok',false,'error',
      'Tu cambio anterior fue a las '||to_char(v_prev at time zone 'America/Lima','HH24:MI')||'; la hora debe ser posterior'); end if;

  insert into area_hora_declarada (dni, fecha, area, hora) values (s.dni, _hoy(), p_area, p_hora)
  on conflict (dni, fecha, area) do update set hora = excluded.hora, creado = now();
  return json_build_object('ok', true, 'aplicado', false);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- 3. Trigger del reclamo: usa la hora declarada si la hay --------------------
create or replace function public._reclamo_mueve_area()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_prev text; v_nom text; v_motivo text; v_hora time; v_ts timestamptz; v_ult timestamptz;
begin
  if NEW.area is null or NEW.estado <> 'ACTIVO' then return NEW; end if;

  select area_actual, nombres_apellidos into v_prev, v_nom
    from operarios where dni = NEW.dni;
  /* Ya está en esa área (el caso normal, y también el resto de un lote de 60:
     la primera fila lo movió). */
  if v_prev is null or v_prev = NEW.area then return NEW; end if;

  /* La hora que declaró al elegir el área (parche 90). Si queda antes de su
     último cambio del día no sirve: se usa la de registro. */
  select hora into v_hora from area_hora_declarada
   where dni = NEW.dni and fecha = _hoy() and area = NEW.area;
  if v_hora is not null then
    v_ts := (_hoy()::text || ' ' || to_char(v_hora,'HH24:MI'))::timestamp at time zone 'America/Lima';
    select max(creado) into v_ult from movimientos_area where dni = NEW.dni and fecha = _hoy();
    if v_ts > now() or (v_ult is not null and v_ts < v_ult) then v_ts := null; end if;
    delete from area_hora_declarada where dni = NEW.dni and fecha = _hoy() and area = NEW.area;
  end if;

  update operarios set area_actual = NEW.area where dni = NEW.dni;
  insert into movimientos_area (dni, area_anterior, area_nueva, movido_por, creado, origen)
  values (NEW.dni, v_prev, NEW.area, NEW.dni, coalesce(v_ts, now()),
          case when v_ts is not null then 'DECLARADO' else 'RECLAMO' end);

  /* Un aviso para ingeniería y otro para la supervisora del área DESTINO, que
     es quien lo va a tener en su equipo. El motivo tiene que ser exacto: decir
     "se movió solo" cuando fue ingeniería quien le asignó el trabajo haría que
     nadie vuelva a creerle a la notificación. */
  v_motivo := case when coalesce(current_setting('samitex.asignando', true),'') = 'on'
                   then 'Ingeniería le asignó tickets de '||NEW.area
                   else 'Se movió solo al reclamar un ticket de '||NEW.area end
           || case when v_ts is not null
                   then ', dice que está ahí desde las '||to_char(v_ts at time zone 'America/Lima','HH24:MI')
                   else ', sin decir desde qué hora' end;
  insert into notificaciones (tipo, para_cargo, para_area, dni_afectado, titulo, detalle)
  values ('CAMBIO_AREA','INGENIERIA', null, NEW.dni,
          coalesce(v_nom, NEW.dni)||' pasó a '||NEW.area,
          'Venía de '||v_prev||'. '||v_motivo||' (OF '||coalesce(NEW.o_f,'—')||').'),
         ('CAMBIO_AREA','SUPERVISORA', NEW.area, NEW.dni,
          coalesce(v_nom, NEW.dni)||' entró a tu área',
          'Venía de '||v_prev||'. '||v_motivo||' (OF '||coalesce(NEW.o_f,'—')||').');
  return NEW;
end $function$;

-- 4. El reparto: una sola función para el día entero o para una persona ------
create or replace function public._disp_reparto(p_fecha date, p_dni text default null)
 returns table(dni text, area text, minutos numeric, modo text)
 language sql stable security definer set search_path to 'public'
as $function$
  with lim as (
    select (p_fecha::text || ' 08:00')::timestamp at time zone 'America/Lima' ini,
           (p_fecha::text || ' 18:20')::timestamp at time zone 'America/Lima' fin,
           620::numeric bruto, 575::numeric efectivo,
           extract(dow from p_fecha) in (0,6) finde
  ),
  gente as (
    select o.dni, o.area_actual from operarios o
     where case when p_dni is null then (o.cargo = 'OPERARIO' and o.estado = 'ACTIVO')
                else o.dni = p_dni end
  ),
  prod as (
    select r.dni, r.area, sum(r.minutos) prod from reclamos r
     where r.fecha = p_fecha and r.estado = 'ACTIVO' and (p_dni is null or r.dni = p_dni)
     group by 1,2
  ),
  /* Fin de semana no laborable: solo cuenta quien registró algo. */
  habiles as (
    select g.* from gente g cross join lim l
     where not l.finde or exists (select 1 from prod p where p.dni = g.dni)
  ),
  mov as (
    select m.dni, m.area_anterior, m.area_nueva, coalesce(m.origen,'RECLAMO') origen,
           least(greatest(m.creado, l.ini), l.fin) t,
           row_number() over (partition by m.dni order by m.creado, m.id) rn,
           count(*)     over (partition by m.dni) n
      from movimientos_area m cross join lim l
     where m.fecha = p_fecha and m.dni in (select h.dni from habiles h)
  ),
  tot as (
    select p.dni, sum(p.prod) tot from prod p where p.area is not null
     group by 1 having sum(p.prod) > 0
  ),
  /* HORA: hay movimientos y todos tienen hora fiable.
     PRODUCCION: produjo algo y (algún movimiento es de registro, o no hay
     movimientos): los 575 se reparten según lo producido en cada área.
     SIN_MOV: no produjo ni se movió: la jornada es de su área actual. */
  modos as (
    select h.dni, h.area_actual,
           case when t.dni is not null
                 and (not exists (select 1 from mov m where m.dni = h.dni)
                      or exists (select 1 from mov m where m.dni = h.dni
                                  and m.origen not in ('MANUAL','DECLARADO','AJUSTADO')))
                then 'PRODUCCION'
                when exists (select 1 from mov m where m.dni = h.dni) then 'HORA'
                else 'SIN_MOV' end modo
      from habiles h left join tot t on t.dni = h.dni
  ),
  /* Un tramo por movimiento (el tiempo ANTERIOR, que es del área que deja)
     más el tramo final desde el último movimiento hasta el fin de turno. */
  tramos as (
    select m.dni, m.area_anterior area,
           coalesce(lag(m.t) over (partition by m.dni order by m.rn), l.ini) desde, m.t hasta
      from mov m cross join lim l
    union all
    select m.dni, m.area_nueva, m.t, l.fin from mov m cross join lim l where m.rn = m.n
  ),
  por_hora as (
    select t.dni, t.area, sum(greatest(0, extract(epoch from (t.hasta - t.desde)) / 60.0)) bruto
      from tramos t join modos x on x.dni = t.dni and x.modo = 'HORA'
     where t.area is not null group by 1,2
  )
  select c.dni, c.area, round(least(c.bruto, l.bruto) / l.bruto * l.efectivo, 1), 'HORA'
    from por_hora c cross join lim l where c.bruto > 0
  union all
  select p.dni, p.area, round(l.efectivo * p.prod / t.tot, 1), 'PRODUCCION'
    from prod p join tot t on t.dni = p.dni
    join modos x on x.dni = p.dni and x.modo = 'PRODUCCION'
    cross join lim l
   where p.area is not null and p.prod > 0
  union all
  select x.dni, x.area_actual, l.efectivo, 'SIN_MOV'
    from modos x cross join lim l where x.modo = 'SIN_MOV' and x.area_actual is not null;
$function$;
revoke all on function public._disp_reparto(date, text) from public, anon, authenticated;

create or replace function public._disp_dia_areas(p_fecha date)
 returns table(dni text, area text, minutos numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  select r.dni, r.area, r.minutos from _disp_reparto(p_fecha, null) r;
$function$;

create or replace function public._disp_prorrateado(p_dni text, p_area text, p_fecha date)
 returns numeric language sql stable set search_path to 'public'
as $function$
  select coalesce((select sum(r.minutos) from _disp_reparto(p_fecha, p_dni) r where r.area = p_area), 0);
$function$;

-- 5. Origen en los movimientos manuales y en las correcciones de hora --------
create or replace function public.fn_cambiar_area(p_dni text, p_token uuid, p_dnis text[], p_area text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  quien operarios;
  d text;
  area_prev text;
begin
  quien := _auth(p_dni, p_token);
  if quien.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;

  foreach d in array p_dnis loop
    select area_actual into area_prev from operarios where dni = d;
    -- Endurecido (punto 7): la supervisora solo mueve a personal de su área.
    if quien.cargo = 'SUPERVISORA' and area_prev <> quien.area_actual then
      continue;
    end if;
    update operarios set area_actual = p_area where dni = d;
    insert into movimientos_area (dni, area_anterior, area_nueva, movido_por, origen)
    values (d, area_prev, p_area, p_dni, 'MANUAL');
  end loop;

  return json_build_object('ok', true);
exception
  when others then
    if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
    return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_movimiento_hora(p_dni text, p_token uuid, p_id bigint, p_hora time)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; m movimientos_area;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  if p_hora is null then return json_build_object('ok',false,'error','Indica la hora'); end if;
  if p_hora < time '00:00' or p_hora > time '23:59' then
    return json_build_object('ok',false,'error','Hora fuera de rango'); end if;

  select * into m from movimientos_area where id = p_id;
  if not found then return json_build_object('ok',false,'error','No existe ese movimiento'); end if;

  update movimientos_area
     set creado = ((m.fecha::text || ' ' || to_char(p_hora,'HH24:MI'))::timestamp
                   at time zone 'America/Lima'),
         origen = 'AJUSTADO'
   where id = p_id;

  return json_build_object('ok', true, 'hora', to_char(p_hora,'HH24:MI'),
    'min_origen',  case when m.area_anterior is null then null
                        else round(_disp_prorrateado(m.dni, m.area_anterior, m.fecha),0) end,
    'min_destino', round(_disp_prorrateado(m.dni, m.area_nueva, m.fecha),0));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_movimiento_hora(p_dni text, p_token uuid, p_id bigint, p_hora time, p_fecha date)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; m movimientos_area; v_fecha date; v_ant date;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  if p_hora is null then return json_build_object('ok',false,'error','Indica la hora'); end if;

  select * into m from movimientos_area where id = p_id;
  if not found then return json_build_object('ok',false,'error','No existe ese movimiento'); end if;

  v_ant   := m.fecha;
  v_fecha := coalesce(p_fecha, m.fecha);
  if v_fecha > _hoy() then
    return json_build_object('ok',false,'error','La fecha no puede ser futura'); end if;

  update movimientos_area
     set fecha  = v_fecha,
         creado = ((v_fecha::text || ' ' || to_char(p_hora,'HH24:MI'))::timestamp
                   at time zone 'America/Lima'),
         origen = 'AJUSTADO'
   where id = p_id;

  return json_build_object('ok', true,
    'hora',  to_char(p_hora,'HH24:MI'),
    'fecha', to_char(v_fecha,'YYYY-MM-DD'),
    'movido_de_dia', (v_ant <> v_fecha),
    'min_origen',  case when m.area_anterior is null then null
                        else round(_disp_prorrateado(m.dni, m.area_anterior, v_fecha),0) end,
    'min_destino', round(_disp_prorrateado(m.dni, m.area_nueva, v_fecha),0),
    'modo', (select max(r.modo) from _disp_reparto(v_fecha, m.dni) r),
    /* Si cambió de día, el reparto del día que dejó también se movió. */
    'fecha_anterior', case when v_ant <> v_fecha then to_char(v_ant,'YYYY-MM-DD') else null end);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- 6. La lista de movimientos dice el origen y cómo quedó el reparto ----------
create or replace function public.fn_movimientos_listar(p_dni text, p_token uuid, p_area text, p_fecha date)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare s operarios; f date := coalesce(p_fecha, _hoy());
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  return coalesce((
    with rep as (
      select r.dni, r.area, r.minutos, r.modo
        from (select distinct m.dni from movimientos_area m where m.fecha = f) z
        cross join lateral _disp_reparto(f, z.dni) r
    )
    select json_agg(json_build_object(
      'id', m.id, 'dni', m.dni, 'nombre', op.nombres_apellidos,
      'desde_area', m.area_anterior, 'hacia_area', m.area_nueva,
      'hora', to_char(m.creado at time zone 'America/Lima','HH24:MI'),
      'fecha', to_char(m.fecha,'YYYY-MM-DD'),
      'movido_por', mp.nombres_apellidos,
      'origen', coalesce(m.origen,'RECLAMO'),
      'modo', (select max(r.modo) from rep r where r.dni = m.dni),
      'min_origen',  case when m.area_anterior is null then null
                          else coalesce((select round(sum(r.minutos),0) from rep r
                                          where r.dni = m.dni and r.area = m.area_anterior),0) end,
      'min_destino', coalesce((select round(sum(r.minutos),0) from rep r
                                where r.dni = m.dni and r.area = m.area_nueva),0))
      order by m.creado)
    from movimientos_area m
    join operarios op on op.dni = m.dni
    left join operarios mp on mp.dni = m.movido_por
    where m.fecha = f
      and (coalesce(trim(p_area),'') = ''
           or m.area_anterior = p_area or m.area_nueva = p_area)), '[]'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
