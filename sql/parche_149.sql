-- PARCHE 149 — Inicio de Ingeniería por áreas
-- fn_inicio_resumen(fecha): por área, en UNA sola consulta, personal, asistentes del día, prendas, minutos producidos,
-- tope (asistentes × jornada), meta mínima (tope × 0,8) y meta del mes con lo acumulado a la fecha.
-- fn_inicio_mes(fecha): lo acumulado del mes por área hasta el día anterior (se guarda 1 vez al día: la 1.ª consulta tarda unos
-- segundos, las demás son instantáneas); el día lo suma el front con fn_inicio_resumen.
-- Asistente = persona activa que no tiene un estado de ausencia ese día, o que registró tickets. Si está marcada "EN <área>"
-- de costura/acabado cuenta en esa área solo si registró tickets allí; si no, sigue en la suya. Corte, Despacho, UDP,
-- Reproceso y Almacén no exigen tickets. Necesita el parche 147 (_pcp_prod). Rollback: parche_149_rollback.sql
begin;

create or replace function public.fn_inicio_resumen(p_dni text, p_token uuid, p_fecha date default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare
  v_f date := coalesce(p_fecha, _hoy()); v_mes date; v_j numeric := _jornada(coalesce(p_fecha, _hoy()));
  v json;
begin
  perform _lector(p_dni, p_token, '');
  v_mes := date_trunc('month', v_f)::date;
  with p as materialized (select * from _pcp_prod(v_f, v_f)),
  tk as (select distinct dni, area from reclamos where fecha = v_f and estado = 'ACTIVO'),
  op as (
    select o.dni, o.area_actual base, coalesce(e.estado, 'ACTIVO') est
      from operarios o
      left join lateral (select a.estado from asistencia a where a.dni = o.dni and a.fecha = v_f order by a.creado desc limit 1) e on true
     where o.cargo = 'OPERARIO' and o.estado = 'ACTIVO'),
  dest as (
    select op.*, case op.est when 'EN ACABADO' then 'ACABADO' when 'EN CAMISAS' then 'CAMISA COSTURA'
             when 'EN SACOS' then 'SACO COSTURA' when 'EN PANTALON' then 'PANTALON COSTURA'
             when 'EN SASTRERIA' then 'UDP' when 'EN REPROCESO' then 'REPROCESO' when 'EN DESPACHO' then 'DESPACHO'
             when 'EN CORTE' then 'CORTE' end d
      from op),
  q as (
    select d.dni,
      case when d.d is not null and (d.d in ('UDP','REPROCESO','DESPACHO','CORTE') or exists (select 1 from tk where tk.dni = d.dni and tk.area = d.d)) then d.d
           else d.base end area,
      not _ausente(d.est) or d.est ~ '^EN ' or exists (select 1 from tk where tk.dni = d.dni) as pres
      from dest d),
  per as (select area, count(*) personal, count(*) filter (where pres) asist from q group by area),
  dia as (select area, sum(prendas) prendas, sum(minutos) minutos from p group by area),
  mt as (select area, meta_minutos from metas_mes where mes = v_mes and alcance = 'AREA'),
  ar as (select area from per union select area from dia union select area from mt)
  select json_build_object('ok', true, 'fecha', v_f, 'jornada', v_j,
    'meta_mes', coalesce((select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION'), (select sum(meta_minutos) from mt)),
    'areas', coalesce((select json_agg(json_build_object('area', ar.area, 'personal', coalesce(per.personal, 0), 'asistentes', coalesce(per.asist, 0),
        'prendas', round(coalesce(dia.prendas, 0)), 'minutos', round(coalesce(dia.minutos, 0)),
        'tope', coalesce(per.asist, 0) * v_j, 'meta_min', round(coalesce(per.asist, 0) * v_j * 0.8),
        'meta_mes', mt.meta_minutos) order by ar.area)
      from ar left join per using (area) left join dia using (area) left join mt using (area)
      where ar.area is not null), '[]'::json)) into v;
  return v;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create table if not exists public.inicio_mes_cache (
  mes date not null, hasta date not null, area text not null, minutos numeric not null, creado date not null default current_date,
  primary key (mes, hasta, area));
alter table public.inicio_mes_cache enable row level security;
revoke all on public.inicio_mes_cache from public, anon, authenticated;

create or replace function public.fn_inicio_mes(p_dni text, p_token uuid, p_fecha date default null)
 returns json language plpgsql volatile security definer set search_path to 'public'
 set statement_timeout to '30s'
as $function$
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

-- Entrar con DNI y PIN correctos deja a la persona ACTIVA (antes una persona INACTIVA no podía ni entrar).
create or replace function public.fn_login(p_dni text, p_pin text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare o operarios; t uuid; v_fallos int; v_ok boolean; v_min int;
begin
  if not fn_horario_ok() then
    return json_build_object('ok', false,
      'error', 'El sistema está fuera de horario. Vuelve dentro del horario de trabajo.');
  end if;

  select * into o from operarios where dni = p_dni and cargo <> 'ESTAJERO';
  if not found then
    return json_build_object('ok', false, 'error', 'DNI o clave incorrectos');
  end if;

  if o.login_bloqueado_hasta is not null and o.login_bloqueado_hasta > now() then
    v_min := ceil(extract(epoch from o.login_bloqueado_hasta - now()) / 60);
    return json_build_object('ok', false, 'intentos_restantes', 0,
      'error', 'Cuenta bloqueada por 5 intentos fallidos. Intenta en ' || v_min || ' min o pide a ingeniería que resetee tu PIN.');
  end if;

  -- Bloqueo vencido: el contador vuelve a cero.
  v_fallos := case when o.login_bloqueado_hasta is not null then 0 else coalesce(o.login_fallos, 0) end;

  if o.pin ~ '^\$2[aby]\$' then
    v_ok := crypt(p_pin, o.pin) = o.pin;
  else
    v_ok := o.pin is not null and o.pin = p_pin;   -- PIN heredado en texto plano
  end if;

  if not v_ok then
    v_fallos := v_fallos + 1;
    update operarios set
      login_fallos = v_fallos,
      login_bloqueado_hasta = case when v_fallos >= 5 then now() + interval '15 minutes' end
    where dni = o.dni;
    if v_fallos >= 5 then
      return json_build_object('ok', false, 'intentos_restantes', 0,
        'error', 'Clave incorrecta. Cuenta bloqueada 15 min. Ingeniería puede resetear tu PIN.');
    end if;
    return json_build_object('ok', false, 'intentos_restantes', 5 - v_fallos,
      'error', 'Clave incorrecta. Te quedan ' || (5 - v_fallos) || ' intento(s).');
  end if;

  t := gen_random_uuid();
  update operarios set
    token = t, token_creado = now(), token_expira = now() + interval '4 hours',
    login_fallos = 0, login_bloqueado_hasta = null,
    pin = case when o.pin ~ '^\$2[aby]\$' then pin else crypt(p_pin, gen_salt('bf')) end
   where dni = o.dni;
  -- Quien entra con su DNI queda ACTIVO; si hoy figuraba con un estado de ausencia, se corrige a ACTIVO.
  update operarios set estado = 'ACTIVO' where dni = o.dni and estado is distinct from 'ACTIVO';
  if o.cargo = 'OPERARIO' and _ausente(_estado_dia(o.dni, _hoy())) then
    insert into asistencia (dni, fecha, estado, registrado_por) values (o.dni, _hoy(), 'ACTIVO', o.dni)
    on conflict (dni, fecha) do update set estado = 'ACTIVO', registrado_por = excluded.registrado_por, creado = now();
  end if;
  return json_build_object('ok', true, 'dni', o.dni,
    'nombre', o.nombres_apellidos, 'cargo', o.cargo,
    'area_actual', o.area_actual, 'token', t,
    'es_admin', coalesce(o.es_admin, false));
end $function$;

commit;
