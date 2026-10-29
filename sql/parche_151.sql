-- PARCHE 151 — Inicio solo con MOD de la estructura y entrada bloqueada a quien no está en planta
-- 1) fn_inicio_resumen: personal y asistentes = solo MOD de estructura_mes vigentes ese día (desde/hasta), en el área
--    de la estructura; la marca "EN <área>" del día sigue mandando. Si el mes no tiene estructura, usa operarios activos.
-- 2) fn_login: ya NO reactiva a nadie. Solo entra quien está ACTIVO y no tiene su estructura del mes cerrada (hasta < hoy).
--    Quien entra queda ACTIVO en la asistencia de hoy si figuraba ausente.
-- Necesita el parche 149. Rollback: parche_151_rollback.sql (vuelve a las versiones del 149).
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
  em as (select dni, area, tipo from estructura_mes where mes = v_mes and (desde is null or desde <= v_f) and (hasta is null or hasta >= v_f)),
  op as (
    select o.dni, coalesce(em.area, o.area_actual) base, coalesce(e.estado, 'ACTIVO') est
      from operarios o
      left join em on em.dni = o.dni
      left join lateral (select a.estado from asistencia a where a.dni = o.dni and a.fecha = v_f order by a.creado desc limit 1) e on true
     where o.cargo = 'OPERARIO'
       and case when exists (select 1 from estructura_mes where mes = v_mes) then em.tipo = 'MOD' else o.estado = 'ACTIVO' end),
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

  select * into o from operarios where dni = p_dni and estado = 'ACTIVO' and cargo <> 'ESTAJERO'
     and not exists (select 1 from estructura_mes em where em.dni = p_dni and em.mes = date_trunc('month', _hoy())::date
                       and em.hasta is not null and em.hasta < _hoy()
                       and not exists (select 1 from estructura_mes e2 where e2.dni = p_dni and e2.mes = em.mes and (e2.hasta is null or e2.hasta >= _hoy())));
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
  -- Quien entra con su DNI queda ACTIVO en la asistencia de hoy si figuraba ausente.
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
