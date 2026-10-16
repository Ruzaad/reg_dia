-- PARCHE 130 — Asistencia: marcar y borrar en bloque desde la Matriz, y estructura por meses
-- 1) fn_asistencia_celdas: guarda un estado (o lo borra) en muchas celdas persona × día de una vez.
--    Al guardar se saltan sábados, domingos y feriados (_laborable, parche 120); borrar vale en cualquier día.
-- 2) fn_asistencia_matriz: misma firma y misma salida, más 'no_lab' {fecha: SAB|DOM|FER} para pintar
--    esas columnas en gris.
-- 3) metas_mes: tabla vacía y lista para las metas mensuales de minutaje y prendas (corporación, área,
--    operario) que cargará PCP. Sin pantalla ni RPC todavía.
-- fn_asignar_estado_rango no se toca (la usan los despliegues viejos). Rollback: parche_130_rollback.sql
begin;

create or replace function public.fn_asistencia_celdas(p_dni text, p_token text, p_celdas jsonb, p_estado text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_est text := nullif(trim(coalesce(p_estado,'')),''); v_n int := 0; v_salt int := 0;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if jsonb_typeof(p_celdas) is distinct from 'array' or jsonb_array_length(p_celdas) = 0 then
    return json_build_object('ok', false, 'error', 'No hay celdas seleccionadas');
  end if;
  if jsonb_array_length(p_celdas) > 5000 then
    return json_build_object('ok', false, 'error', 'Máximo 5000 celdas por vez');
  end if;

  if v_est is null then
    with c as (select distinct x->>'dni' dni, (x->>'fecha')::date fecha from jsonb_array_elements(p_celdas) x)
    delete from asistencia a using c where a.dni = c.dni and a.fecha = c.fecha;
    get diagnostics v_n = row_count;
    return json_build_object('ok', true, 'borrados', v_n);
  end if;

  if not exists (select 1 from estados_asistencia where nombre = v_est) then
    return json_build_object('ok', false, 'error', 'Estado no válido: ' || v_est);
  end if;

  select count(distinct (x->>'dni', x->>'fecha')) into v_salt
  from jsonb_array_elements(p_celdas) x where not _laborable((x->>'fecha')::date);
  insert into asistencia (dni, fecha, estado, registrado_por, creado)
  select distinct x->>'dni', (x->>'fecha')::date, v_est, p_dni, now()
  from jsonb_array_elements(p_celdas) x
  where _laborable((x->>'fecha')::date)
  on conflict (dni, fecha)
  do update set estado = excluded.estado, registrado_por = excluded.registrado_por, creado = now();
  get diagnostics v_n = row_count;

  return json_build_object('ok', true, 'guardados', v_n, 'saltados', v_salt);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_asistencia_matriz(p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_dias json; v_personal json; v_nolab json;
begin
  perform _lector(p_dni, p_token, p_area);
  if p_hasta < p_desde then return json_build_object('ok',false,'error','Rango inválido'); end if;
  if (p_hasta - p_desde) > 62 then return json_build_object('ok',false,'error','Rango máximo 62 días'); end if;

  select json_agg(to_char(d,'YYYY-MM-DD') order by d),
         coalesce(json_object_agg(to_char(d,'YYYY-MM-DD'),
                  case when _feriado(d::date) then 'FER' when extract(isodow from d) = 6 then 'SAB' else 'DOM' end)
                  filter (where not _laborable(d::date)), '{}'::json)
    into v_dias, v_nolab
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

  return json_build_object('ok', true, 'dias', coalesce(v_dias,'[]'::json), 'no_lab', v_nolab,
                           'personal', coalesce(v_personal,'[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create table if not exists public.metas_mes (
  id bigserial primary key,
  mes date not null check (extract(day from mes) = 1),
  alcance text not null check (alcance in ('CORPORACION','AREA','OPERARIO')),
  area text,
  dni text references public.operarios(dni),
  meta_minutos numeric check (meta_minutos >= 0),
  meta_prendas numeric check (meta_prendas >= 0),
  cargado_por text references public.operarios(dni),
  actualizado timestamptz not null default now(),
  check ((alcance = 'CORPORACION' and area is null and dni is null)
      or (alcance = 'AREA' and area is not null and dni is null)
      or (alcance = 'OPERARIO' and area is not null and dni is not null))
);
comment on table public.metas_mes is 'Metas mensuales de minutaje y prendas (PCP). mes = primer día del mes. OPERARIO guarda también su área de ese mes.';
create unique index if not exists metas_mes_uk on public.metas_mes (mes, alcance, coalesce(area,''), coalesce(dni,''));
create index if not exists metas_mes_dni on public.metas_mes (dni, mes) where dni is not null;
alter table public.metas_mes enable row level security;
drop trigger if exists perm_area_trg on public.metas_mes;
create trigger perm_area_trg after insert or delete or update on public.metas_mes
  for each row when (current_setting('app.perm', true) like '|%')
  execute function _perm_area_trg('area');

grant execute on function public.fn_asistencia_celdas(text, text, jsonb, text) to anon, authenticated;

commit;
