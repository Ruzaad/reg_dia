-- PARCHE 122 — Entrar a CORTE, REPROCESO y DESPACHO eligiendo el área
-- Arreglo: nadie podía entrar a esas áreas porque no están en areas_config y
-- la pantalla de elegir área solo mostraba las de costura y ACABADO. La app ya
-- las muestra; con este parche, quien elige una de ellas al entrar trabaja ahí
-- hoy en lotes aunque su supervisora no lo haya marcado EN <área> (antes le
-- salía "Hoy no estás en DESPACHO").
-- No cambia su área en operarios: quien elige DESPACHO sigue siendo de ACABADO.
-- Rollback: parche_122_rollback.sql
begin;

create table if not exists public.lote_area_elegida (
  dni     text not null,
  fecha   date not null,
  area    text not null check (area in ('DESPACHO','REPROCESO','CORTE')),
  creado  timestamptz not null default now(),
  primary key (dni, fecha)
);
alter table public.lote_area_elegida enable row level security;
revoke all on public.lote_area_elegida from anon, authenticated;

-- Área de lotes de una persona hoy (null = no trabaja por tiempo hoy).
-- Parche 122: lo que eligió al entrar manda; luego la asistencia; luego su área.
create or replace function public._lote_area_hoy(o operarios)
 returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select e.area from lote_area_elegida e where e.dni = o.dni and e.fecha = _hoy()),
    (select case a.estado when 'EN DESPACHO' then 'DESPACHO' when 'EN REPROCESO' then 'REPROCESO' when 'EN CORTE' then 'CORTE' end
       from asistencia a where a.dni = o.dni and a.fecha = _hoy()
      order by a.creado desc limit 1),
    case when o.area_actual in ('CORTE','REPROCESO') then o.area_actual end)
$$;
revoke all on function public._lote_area_hoy(operarios) from public, anon, authenticated;

-- El operario eligió un área al entrar. Si no es de lotes, se borra lo de hoy.
create or replace function public.fn_lote_elegir_area(p_dni text, p_token uuid, p_area text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_area text := upper(trim(coalesce(p_area,'')));
begin
  o := _auth(p_dni, p_token);
  if o.cargo not in ('OPERARIO','ESTAJERO') then return json_build_object('ok', true, 'area', null); end if;
  if v_area not in ('DESPACHO','REPROCESO','CORTE') then
    delete from lote_area_elegida where dni = o.dni and fecha = _hoy();
    return json_build_object('ok', true, 'area', null);
  end if;
  insert into lote_area_elegida (dni, fecha, area) values (o.dni, _hoy(), v_area)
  on conflict (dni, fecha) do update set area = excluded.area, creado = now();
  return json_build_object('ok', true, 'area', v_area);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_lote_elegir_area(text, uuid, text) to anon, authenticated;

commit;
