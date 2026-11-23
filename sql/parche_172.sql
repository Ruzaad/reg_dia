-- PARCHE 172 — PCP: Calendario mensual de metas con redistribución (minutos y prendas).
-- 1) dias_habilitados: sábados/domingos que SÍ se trabajan (excepciones). Un día laborable que se pierde (ej. lunes 16 por el Papa) se marca como feriado.
-- 2) _habil(fecha) = laborable (lunes a viernes sin feriado) o habilitado.
-- 3) fn_pcp_calendario (lectura): por día, hábil/tipo, disponible, programado y real (minutos y prendas) + metas del mes.
-- 4) fn_pcp_dia_cambiar: habilitar/deshabilitar un día. fn_pcp_meta_mes_guardar: meta mensual de minutos y prendas.
-- 5) fn_pcp_meta_guardar ya no borra la meta de prendas de la corporación.
-- Rollback: parche_172_rollback.sql
begin;

create table if not exists public.dias_habilitados (
  fecha date primary key,
  motivo text,
  registrado_por text,
  creado timestamptz not null default now()
);
comment on table public.dias_habilitados is 'Sábados o domingos que se trabajan (excepción al calendario normal). Los días perdidos van en feriados.';
alter table public.dias_habilitados enable row level security;
revoke all on public.dias_habilitados from anon, authenticated;

create or replace function public._habil(p date)
 returns boolean language sql stable as
$$ select _laborable(p) or exists (select 1 from public.dias_habilitados h where h.fecha = p) $$;

create or replace function public.fn_pcp_calendario(p_dni text, p_token uuid, p_mes date default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare
  o operarios; v_hoy date := _hoy(); v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_fin date;
  v_jor numeric; v_mm numeric; v_mp numeric; v_dias json; v_sam numeric;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  v_fin := (v_mes + interval '1 month - 1 day')::date;
  v_jor := coalesce((select _jornada(d::date) from generate_series(v_mes, v_fin, '1 day') d where _laborable(d::date) limit 1), 575);
  select coalesce(max(meta_minutos) filter (where alcance = 'CORPORACION'), sum(meta_minutos) filter (where alcance = 'AREA'), 0),
         coalesce(max(meta_prendas) filter (where alcance = 'CORPORACION'), sum(meta_prendas) filter (where alcance = 'AREA'), 0)
    into v_mm, v_mp from metas_mes where mes = v_mes and dni is null;

  with hd as materialized (
    select g::date d from generate_series(v_mes - 10, v_fin + 130, '1 day') g
     where (extract(isodow from g) < 6 and not exists (select 1 from feriados f where f.fecha = g::date))
        or exists (select 1 from dias_habilitados h where h.fecha = g::date)),
  p as materialized (
    select ini, fin, cant_prog * std mi, cant_prog un
      from (select ini_costura ini, case when fin_costura is null or fin_costura < ini_costura then ini_costura else least(fin_costura, ini_costura + 120) end fin,
                   cant_prog, std from pcp_programa where ini_costura is not null and cant_prog > 0) q
     where ini <= v_fin and fin >= v_mes),
  pn as materialized (
    select p.*, (select count(*) from hd where hd.d between p.ini and p.fin) n from p),
  pd as (
    select hd.d f, sum(mi / n) mi, sum(un / n) un
      from pn join hd on hd.d between pn.ini and pn.fin and hd.d between v_mes and v_fin
     where pn.n > 0 group by 1),
  pr as (
    select fecha f, sum(prendas) un, sum(minutos) mi from (
      select fecha, prendas, minutos from _pcp_prod(v_mes, v_fin) x
       where x.area <> 'UDP' and not (x.area = 'CORTE' and exists (select 1 from corte_manual c where c.fecha = x.fecha and c.area = 'CORTE'))
      union all
      select fecha, prendas, minutos from corte_manual where fecha between v_mes and v_fin and area in ('CORTE', 'REPROCESO')) z group by 1),
  di as (select d.f, case when d.f in (select d from hd) then
           (select count(*) from estructura_mes e where e.mes = v_mes and e.tipo = 'MOD' and e.area <> 'UDP'
               and (e.desde is null or e.desde <= d.f) and (e.hasta is null or e.hasta >= d.f)) * v_jor else 0 end disp
           from (select g::date f from generate_series(v_mes, v_fin, '1 day') g) d)
  select json_agg(json_build_object('f', di.f, 'habil', di.f in (select d from hd),
           'tipo', case when exists (select 1 from feriados fe where fe.fecha = di.f) then 'feriado'
                        when extract(isodow from di.f) = 6 then 'sabado' when extract(isodow from di.f) = 7 then 'domingo' else 'normal' end,
           'motivo', coalesce((select fe.motivo from feriados fe where fe.fecha = di.f), (select h.motivo from dias_habilitados h where h.fecha = di.f)),
           'hab_extra', exists (select 1 from dias_habilitados h where h.fecha = di.f),
           'disp_min', di.disp, 'prog_min', round(coalesce(pd.mi, 0)), 'prog_un', round(coalesce(pd.un, 0)),
           'real_min', round(coalesce(pr.mi, 0)), 'real_un', round(coalesce(pr.un, 0))) order by di.f)
    into v_dias
    from di left join pd on pd.f = di.f left join pr on pr.f = di.f;

  select sum(cant_prog * std) / nullif(sum(cant_prog), 0) into v_sam from pcp_programa
   where cant_prog > 0 and ini_costura is not null and ini_costura <= v_fin and coalesce(fin_costura, ini_costura) >= v_mes;

  return json_build_object('ok', true, 'mes', v_mes, 'hoy', v_hoy, 'jornada', v_jor, 'meta_min', v_mm, 'meta_un', v_mp, 'sam', round(coalesce(v_sam, 0), 2),
    'puede_editar', coalesce(o.es_admin, false) or exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR'),
    'dias', coalesce(v_dias, '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_pcp_dia_cambiar(p_dni text, p_token uuid, p_fecha date, p_habil boolean, p_motivo text default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_wd boolean := extract(isodow from p_fecha) >= 6;
begin
  o := _pcp_editor(p_dni, p_token);
  if p_fecha is null then return json_build_object('ok', false, 'error', 'Falta la fecha'); end if;
  if p_habil then
    delete from feriados where fecha = p_fecha;
    if v_wd then
      insert into dias_habilitados (fecha, motivo, registrado_por) values (p_fecha, nullif(trim(p_motivo), ''), o.dni)
        on conflict (fecha) do update set motivo = excluded.motivo, registrado_por = excluded.registrado_por;
    end if;
  else
    delete from dias_habilitados where fecha = p_fecha;
    if not v_wd then
      insert into feriados (fecha, motivo, registrado_por) values (p_fecha, coalesce(nullif(trim(p_motivo), ''), 'Día no laborable'), o.dni)
        on conflict (fecha) do update set motivo = excluded.motivo;
    end if;
  end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_pcp_meta_mes_guardar(p_dni text, p_token uuid, p_mes date, p_minutos numeric, p_prendas numeric)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_mes date := date_trunc('month', p_mes)::date;
begin
  o := _pcp_editor(p_dni, p_token);
  perform _perm_set(o);
  delete from metas_mes where mes = v_mes and alcance = 'CORPORACION' and dni is null;
  if coalesce(p_minutos, 0) > 0 or coalesce(p_prendas, 0) > 0 then
    insert into metas_mes (mes, alcance, meta_minutos, meta_prendas, cargado_por)
      values (v_mes, 'CORPORACION', round(coalesce(p_minutos, 0)), nullif(round(coalesce(p_prendas, 0)), 0), o.dni);
  end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* fn_pcp_meta_guardar: al reescribir la corporación conserva la meta de prendas. */
create or replace function public.fn_pcp_meta_guardar(p_dni text, p_token uuid, p_mes date, p_metas jsonb)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_mes date := date_trunc('month', p_mes)::date; x jsonb; v_al text; v_ar text; v_m numeric; v_p numeric; v_n int := 0;
begin
  o := _pcp_editor(p_dni, p_token);
  perform _perm_set(o);
  if v_mes is null or jsonb_typeof(p_metas) is distinct from 'array' then
    return json_build_object('ok', false, 'error', 'Faltan el mes o las metas');
  end if;
  for x in select * from jsonb_array_elements(p_metas) loop
    v_al := upper(trim(x->>'alcance'));
    v_ar := case when v_al = 'AREA' then nullif(upper(trim(x->>'area')), '') end;
    v_m := nullif(x->>'meta_minutos', '')::numeric;
    if v_al not in ('CORPORACION','AREA') or (v_al = 'AREA' and v_ar is null) then continue; end if;
    select meta_prendas into v_p from metas_mes where mes = v_mes and alcance = v_al and area is not distinct from v_ar and dni is null;
    delete from metas_mes where mes = v_mes and alcance = v_al and area is not distinct from v_ar and dni is null;
    if coalesce(v_m, 0) > 0 then
      insert into metas_mes (mes, alcance, area, meta_minutos, meta_prendas, cargado_por) values (v_mes, v_al, v_ar, round(v_m), v_p, o.dni);
    end if;
    v_n := v_n + 1;
  end loop;
  return json_build_object('ok', true, 'guardadas', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_pcp_calendario(text, uuid, date), public.fn_pcp_dia_cambiar(text, uuid, date, boolean, text),
  public.fn_pcp_meta_mes_guardar(text, uuid, date, numeric, numeric) from public;
grant execute on function public.fn_pcp_calendario(text, uuid, date), public.fn_pcp_dia_cambiar(text, uuid, date, boolean, text),
  public.fn_pcp_meta_mes_guardar(text, uuid, date, numeric, numeric) to anon, authenticated;
commit;
