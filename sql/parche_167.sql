-- PARCHE 167 — Bonificación › Cargar Bon. Corte
-- CORTE trabaja por tiempo y no tiene eficiencia por tickets. Se carga como eficiencia manual:
--  · quien viene en la tabla pegada: su eficiencia de ese día;
--  · el resto del personal de CORTE (si se pide): el % del bono modular de CORTE de ese día;
--  · si la persona reclamó tickets en otra área, solo se le suma lo que le falta para llegar a esa eficiencia;
--  · nunca en días no laborables ni con asistencia de ausencia (FALTA, PH, DM, VAC…).
-- Funciones nuevas: _bon_corte_aplicar (interna) y fn_bon_corte_cargar (RPC). No cambia ninguna existente.
begin;

create or replace function public._bon_corte_aplicar(p_desde date, p_hasta date, p_filas jsonb, p_usuario text, p_modular boolean)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_lista int; v_mod int; v_aus int; v_sobra int;
begin
  create temp table _bc on commit drop as
  with lista as (
    select lpad(trim(x->>'dni'), 8, '0') dni, (x->>'fecha')::date f, (x->>'pct')::numeric pct
      from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) x
     where nullif(trim(x->>'dni'), '') is not null and (x->>'fecha') is not null and nullif(x->>'pct', '') is not null
  ),
  gente as (
    select o.dni from operarios o
     where o.area_origen = 'CORTE' and o.cargo = 'OPERARIO' and o.estado = 'ACTIVO'
       and (p_modular or o.dni in (select dni from lista))
    union select dni from lista where dni in (select dni from operarios where area_origen = 'CORTE')
  ),
  dias as (select d::date f from generate_series(p_desde, p_hasta, interval '1 day') d where _laborable(d::date)),
  est as (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado, row_number() over (partition by a.dni, a.fecha order by a.creado desc) rn
        from asistencia a where a.fecha between p_desde and p_hasta) z where rn = 1),
  prod as (
    select dni, fecha, sum(minutos) m from (
      select dni, fecha, minutos from reclamos where fecha between p_desde and p_hasta and estado = 'ACTIVO'
      union all select dni, fecha, minutos from minutos_consideracion where fecha between p_desde and p_hasta) z
     group by 1, 2),
  ocu as (select dni, fecha, sum(minutos) m from ocurrencias where fecha between p_desde and p_hasta group by 1, 2),
  modc as (select fecha, pct from bono_modular_dia where area = 'CORTE' and fecha between p_desde and p_hasta)
  select g.dni, d.f, l.pct pct_lista, case when p_modular then mc.pct end pct_mod,
         _ausente(coalesce(e.estado, 'ACTIVO')) ausente,
         case when _jornada(d.f) + coalesce(o.m, 0) > 0
              then coalesce(p.m, 0) / (_jornada(d.f) + coalesce(o.m, 0)) * 100 else 0 end ef_tk
    from gente g cross join dias d
    left join lista l on l.dni = g.dni and l.f = d.f
    left join modc mc on mc.fecha = d.f
    left join est e on e.dni = g.dni and e.fecha = d.f
    left join prod p on p.dni = g.dni and p.fecha = d.f
    left join ocu o on o.dni = g.dni and o.fecha = d.f;

  select count(*) filter (where ausente and coalesce(pct_lista, pct_mod) is not null) into v_aus from _bc;
  select count(*) filter (where not ausente and coalesce(pct_lista, pct_mod) is not null
                            and coalesce(pct_lista, pct_mod) - ef_tk <= 0) into v_sobra from _bc;

  insert into eficiencia_manual (dni, fecha, pct, registrado_por)
  select dni, f, round(pct_lista - ef_tk, 1), p_usuario
    from _bc where not ausente and pct_lista is not null and pct_lista - ef_tk > 0
  on conflict (dni, fecha) do update
    set pct = excluded.pct, registrado_por = excluded.registrado_por, creado = now();
  -- El modular nunca pisa una eficiencia manual ya cargada (por tabla o a mano).
  insert into eficiencia_manual (dni, fecha, pct, registrado_por)
  select dni, f, round(pct_mod - ef_tk, 1), p_usuario
    from _bc where not ausente and pct_lista is null and pct_mod is not null and pct_mod - ef_tk > 0
  on conflict (dni, fecha) do nothing;

  select count(*) filter (where not ausente and pct_lista is not null and pct_lista - ef_tk > 0),
         count(*) filter (where not ausente and pct_lista is null and pct_mod is not null and pct_mod - ef_tk > 0)
    into v_lista, v_mod from _bc;
  drop table _bc;
  return json_build_object('ok', true, 'por_tabla', v_lista, 'por_modular', v_mod,
                           'ausentes', v_aus, 'ya_llegaban', v_sobra);
end $function$;
revoke all on function public._bon_corte_aplicar(date, date, jsonb, text, boolean) from public, anon, authenticated;

create or replace function public.fn_bon_corte_cargar(p_dni text, p_token uuid, p_desde date, p_hasta date, p_filas jsonb, p_modular boolean default true)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios;
begin
  s := _vista(p_dni, p_token, array['pasoInc'], 'CORTE');
  perform _vista_area(s, array['CORTE'], true);
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Rango inválido'; end if;
  if p_hasta - p_desde > 40 then raise exception 'Rango máximo 40 días (una quincena)'; end if;
  return _bon_corte_aplicar(p_desde, p_hasta, p_filas, s.dni, coalesce(p_modular, true));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_bon_corte_cargar(text, uuid, date, date, jsonb, boolean) from public;
grant execute on function public.fn_bon_corte_cargar(text, uuid, date, date, jsonb, boolean) to anon, authenticated;

commit;
