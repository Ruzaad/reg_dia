-- ROLLBACK PARCHE 125 — vuelve fn_costos_reporte y fn_avance_area a la regla
-- del N°OP y quita la elección manual de última / penúltima.
begin;

-- -----------------------------------------------------------------------
create or replace function public.fn_costos_reporte(p_dni text, p_token uuid, p_fecha date, p_area text default '')
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_tk json; v_ult json; v_inc json;
begin
  perform _lector(p_dni, p_token, coalesce(p_area,''));
  if p_fecha is null then raise exception 'Indica la fecha'; end if;

  with t as (
    select r.area, upper(trim(r.articulo)) art, r.o_f, r.op, r.nop,
           sum(r.cant) cant, count(*) tks
      from reclamos r
     where r.fecha = p_fecha and r.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or r.area = p_area)
     group by 1,2,3,4,5
  )
  select coalesce(json_agg(json_build_object('area', area, 'articulo', art, 'of', o_f,
           'op', op, 'nop', nop, 'cant', cant, 'tks', tks)), '[]'::json)
    into v_tk from t;

  with arts as (
    select distinct r.area, upper(trim(r.articulo)) art
      from reclamos r
     where r.fecha = p_fecha and r.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or r.area = p_area)
  ), b as (
    select distinct b.area, a.art, b.n_op
      from bases b join arts a on a.area = b.area and upper(trim(b.articulo)) = a.art
     where b.n_op > 0
  ), k as (
    select area, art, n_op, dense_rank() over (partition by area, art order by n_op desc) k from b
  )
  select coalesce(json_agg(json_build_object('area', area, 'articulo', art, 'n1', n1, 'n2', n2)), '[]'::json)
    into v_ult
    from (select area, art, max(n_op) filter (where k = 1) n1, max(n_op) filter (where k = 2) n2
            from k group by area, art) z;

  select coalesce(json_agg(json_build_object(
      'nombre', o.nombres_apellidos, 'area', oc.area, 'tipo', oc.tipo,
      'minutos', oc.minutos, 'detalle', oc.detalle,
      'hora', to_char(oc.creado at time zone 'America/Lima','HH24:MI'))
      order by oc.creado desc), '[]'::json)
    into v_inc
    from ocurrencias oc join operarios o on o.dni = oc.dni
   where oc.fecha = p_fecha and (coalesce(p_area,'') = '' or oc.area = p_area);

  return json_build_object('ok', true, 'fecha', to_char(p_fecha,'YYYY-MM-DD'),
    'tickets', v_tk, 'ultimas', v_ult, 'incidencias', v_inc);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- -----------------------------------------------------------------------
create or replace function public.fn_avance_area(p_dni text, p_token uuid, p_area text,
  p_nivel text default 'ultima', p_modulo text default '')
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare
  s operarios; hoy date := _hoy();
  v_personas int; v_disp numeric := 0; v_prod numeric := 0;
  v_items json; v_sinbase json; v_modulos json;
  v_off int := case when lower(coalesce(p_nivel,'ultima')) = 'penultima' then 1 else 0 end;
  v_mod text := coalesce(p_modulo,'');
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  if s.cargo = 'SUPERVISORA' and p_area <> s.area_actual then raise exception 'NO_AUTORIZADA'; end if;

  with candidatos as (
    select o.dni from operarios o
    where o.estado = 'ACTIVO' and o.cargo = 'OPERARIO'
      and not _ausente(_estado_dia(o.dni, hoy))
      and (o.area_actual = p_area
           or exists (select 1 from movimientos_area m
                      where m.dni = o.dni and m.fecha = hoy
                        and (m.area_anterior = p_area or m.area_nueva = p_area)))
  ),
  calc as (
    select c.dni, _disp_prorrateado(c.dni, p_area, hoy) disp_p from candidatos c
  )
  select count(*) filter (where disp_p > 0),
         coalesce(sum(disp_p + coalesce((select sum(oc.minutos) from ocurrencias oc
                       where oc.dni = calc.dni and oc.fecha = hoy),0)),0)
    into v_personas, v_disp from calc;

  -- Base por artículo: total de la prenda y su operación máxima (max_op).
  with ba as (
    select articulo, min(modulo) modulo, sum(std) t_total, max(max_op) maxop
    from bases where area = p_area group by articulo
  ),
  -- PROD del área (KPI): siempre la ÚLTIMA operación, todo el área.
  notif_kpi as (
    select r.articulo, sum(r.cant) unidades, ba.t_total
    from reclamos r
    join ba on ba.articulo = r.articulo and r.nop = ba.maxop
    join operarios op on op.dni = r.dni and op.cargo = 'OPERARIO'
    where r.area = p_area and r.fecha = hoy and r.estado = 'ACTIVO'
    group by r.articulo, ba.t_total
  ),
  -- ITEMS: según nivel (ultima|penultima) y módulo elegido.
  notif as (
    select r.articulo, r.o_f, r.modulo, sum(r.cant) unidades, ba.t_total
    from reclamos r
    join ba on ba.articulo = r.articulo
           and r.nop = (ba.maxop - v_off) and (ba.maxop - v_off) >= 1
    join operarios op on op.dni = r.dni and op.cargo = 'OPERARIO'
    where r.area = p_area and r.fecha = hoy and r.estado = 'ACTIVO'
      and (v_mod = '' or r.modulo = v_mod)
    group by r.articulo, r.o_f, r.modulo, ba.t_total
  )
  select (select coalesce(sum(unidades * t_total),0) from notif_kpi),
         coalesce(json_agg(json_build_object(
           'articulo',articulo,'of',o_f,'modulo',modulo,'unidades',unidades,
           't_total',round(t_total,2),
           'minutos',round(unidades * t_total,1))
           order by modulo, articulo, o_f), '[]'::json)
    into v_prod, v_items from notif;

  select coalesce(json_agg(distinct r.articulo), '[]'::json) into v_sinbase
  from reclamos r
  where r.area = p_area and r.fecha = hoy and r.estado = 'ACTIVO'
    and not exists (select 1 from bases b where b.area = p_area and b.articulo = r.articulo);

  select coalesce(json_agg(distinct modulo order by modulo) filter (where modulo is not null and modulo <> ''), '[]'::json)
    into v_modulos from bases where area = p_area;

  return json_build_object('ok', true, 'personas', v_personas,
    'minutos_disp', round(v_disp,0), 'minutos_prod', round(v_prod,1),
    'eficiencia', case when v_disp > 0 then round(v_prod / v_disp * 100, 1) else 0 end,
    'items', v_items, 'sin_base', v_sinbase, 'modulos', v_modulos,
    'nivel', case when v_off = 1 then 'penultima' else 'ultima' end);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

drop function if exists public.fn_ultimas_guardar(text, uuid, text, text, integer, integer);
drop function if exists public.fn_ultimas_area(text, uuid, text);
drop function if exists public._ultimas(text);
drop table if exists public.ultimas_articulo;

commit;
