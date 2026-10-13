-- PARCHE 125 — Última y penúltima operación elegidas por el analista
-- Por defecto la última operación de un artículo es su mayor N°OP en la BASE y
-- la penúltima la siguiente. En algunos artículos la operación que sirve para
-- el balance no es esa (p. ej. la última es un control o un empaque que no
-- todos registran). Ingeniería puede fijar, por área y artículo, cuál es la
-- última y cuál la penúltima; si no fija nada, sigue la regla del N°OP.
--
-- 1) Tabla ultimas_articulo: guarda la elección por op_id (las BASES se
--    renumeran) y el nombre de la operación de respaldo por si la BASE se
--    vuelve a subir y cambian los op_id.
-- 2) _ultimas(area): N°OP efectivo de la última (n1) y la penúltima (n2) de
--    cada artículo. Si solo se fijó la última, la penúltima es el mayor N°OP
--    por debajo de ella.
-- 3) fn_ultimas_area: la lista por área para Ingeniería (Bases, Tickets,
--    Reporte de hoy, Costos).
-- 4) fn_ultimas_guardar: fija o vuelve a automático (null = automático).
-- 5) fn_costos_reporte y fn_avance_area usan _ultimas. Misma firma y misma
--    forma de respuesta: los despliegues viejos siguen funcionando.

begin;

-- 1) ------------------------------------------------------------------------
create table if not exists public.ultimas_articulo (
  area            text not null,
  articulo        text not null,          -- _nk(articulo)
  op_ultima       bigint,                 -- bases.op_id
  op_penultima    bigint,
  nom_ultima      text,
  nom_penultima   text,
  actualizado_por text,
  actualizado     timestamptz not null default now(),
  primary key (area, articulo)
);
alter table public.ultimas_articulo enable row level security;
revoke all on public.ultimas_articulo from anon, authenticated;

-- 2) ------------------------------------------------------------------------
create or replace function public._ultimas(p_area text)
 returns table(area text, k text, articulo text, n1 int, n2 int, auto1 int, auto2 int, manual boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  -- Se agrupa primero por el texto crudo: _nk por fila de bases cuesta ~1 s en
  -- todas las áreas; por artículo y con los índices de (area, _nk(articulo), …) baja a ~0.3 s.
  with a0 as (
    select b.area, b.articulo, max(b.n_op) a1 from bases b
     where (coalesce(p_area,'') = '' or b.area = p_area) and b.n_op > 0
     group by 1,2
  ), a as (
    select a0.area, _nk(a0.articulo) k, min(upper(trim(a0.articulo))) art, max(a0.a1) a1
      from a0 group by 1,2
  ), m as materialized (
    select a.*,
      coalesce(
        (select b.n_op from bases b where b.op_id = u.op_ultima and b.area = a.area
            and _nk(b.articulo) = a.k and b.n_op > 0),
        (select max(b.n_op) from bases b where u.nom_ultima is not null and b.area = a.area
            and _nk(b.articulo) = a.k and _nk(b.operacion) = _nk(u.nom_ultima) and b.n_op > 0)) mu,
      coalesce(
        (select b.n_op from bases b where b.op_id = u.op_penultima and b.area = a.area
            and _nk(b.articulo) = a.k and b.n_op > 0),
        (select max(b.n_op) from bases b where u.nom_penultima is not null and b.area = a.area
            and _nk(b.articulo) = a.k and _nk(b.operacion) = _nk(u.nom_penultima) and b.n_op > 0)) mp
      from a left join ultimas_articulo u on u.area = a.area and u.articulo = a.k
  )
  select m.area, m.k, m.art,
         coalesce(m.mu, m.a1),
         coalesce(m.mp, (select max(b.n_op) from bases b where b.area = m.area and _nk(b.articulo) = m.k
                           and b.n_op > 0 and b.n_op < coalesce(m.mu, m.a1))),
         m.a1,
         (select max(b.n_op) from bases b where b.area = m.area and _nk(b.articulo) = m.k
             and b.n_op > 0 and b.n_op < m.a1),
         (m.mu is not null or m.mp is not null)
    from m
$function$;

revoke all on function public._ultimas(text) from public, anon, authenticated;

-- 3) ------------------------------------------------------------------------
create or replace function public.fn_ultimas_area(p_dni text, p_token uuid, p_area text)
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform _lector(p_dni, p_token, p_area);
  return coalesce((select json_agg(json_build_object(
      'articulo', u.articulo, 'n1', u.n1, 'n2', u.n2,
      'auto1', u.auto1, 'auto2', u.auto2, 'manual', u.manual,
      'fija1', x.nom_ultima is not null, 'fija2', x.nom_penultima is not null,
      'por', x.actualizado_por,
      'cuando', to_char(x.actualizado at time zone 'America/Lima', 'DD/MM HH24:MI'))
      order by u.articulo)
    from _ultimas(p_area) u
    left join ultimas_articulo x on u.manual and x.area = u.area and x.articulo = u.k), '[]'::json);
end $function$;

revoke all on function public.fn_ultimas_area(text, uuid, text) from public;
grant execute on function public.fn_ultimas_area(text, uuid, text) to anon, authenticated;

-- 4) ------------------------------------------------------------------------
create or replace function public.fn_ultimas_guardar(p_dni text, p_token uuid, p_area text,
  p_articulo text, p_nop_ultima integer, p_nop_penultima integer)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_k text := _nk(p_articulo); a1 int; a2 int; bu bases; bp bases;
begin
  o := _lector(p_dni, p_token, p_area);
  if not coalesce(o.es_admin, false) and o.cargo <> 'INGENIERIA' then
    raise exception 'NO_AUTORIZADA'; end if;
  if coalesce(trim(p_area),'') = '' or v_k = '' then
    return json_build_object('ok', false, 'error', 'Indica el área y el artículo'); end if;

  select u.auto1, u.auto2 into a1, a2 from _ultimas(p_area) u where u.k = v_k;
  if a1 is null then
    return json_build_object('ok', false, 'error', 'Ese artículo no tiene BASE en ' || p_area); end if;

  if p_nop_penultima = coalesce(p_nop_ultima, a1) then
    return json_build_object('ok', false, 'error', 'La última y la penúltima no pueden ser la misma operación'); end if;

  if p_nop_ultima is not null then
    select * into bu from bases b where b.area = p_area and _nk(b.articulo) = v_k and b.n_op = p_nop_ultima
     order by b.id limit 1;
    if not found then
      return json_build_object('ok', false, 'error', 'No existe el N°OP ' || p_nop_ultima || ' en la BASE'); end if;
  end if;
  if p_nop_penultima is not null then
    select * into bp from bases b where b.area = p_area and _nk(b.articulo) = v_k and b.n_op = p_nop_penultima
     order by b.id limit 1;
    if not found then
      return json_build_object('ok', false, 'error', 'No existe el N°OP ' || p_nop_penultima || ' en la BASE'); end if;
  end if;

  -- Lo mismo que la regla automática no se guarda: así sigue a la BASE si se renumera.
  if (p_nop_ultima is null or p_nop_ultima = a1)
     and (p_nop_penultima is null or p_nop_penultima is not distinct from a2) then
    delete from ultimas_articulo where area = p_area and articulo = v_k;
    return json_build_object('ok', true, 'manual', false);
  end if;

  insert into ultimas_articulo (area, articulo, op_ultima, op_penultima, nom_ultima, nom_penultima,
                                actualizado_por, actualizado)
  values (p_area, v_k, bu.op_id, bp.op_id, bu.operacion, bp.operacion, o.dni, now())
  on conflict (area, articulo) do update set
    op_ultima = excluded.op_ultima, op_penultima = excluded.op_penultima,
    nom_ultima = excluded.nom_ultima, nom_penultima = excluded.nom_penultima,
    actualizado_por = excluded.actualizado_por, actualizado = excluded.actualizado;
  return json_build_object('ok', true, 'manual', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_ultimas_guardar(text, uuid, text, text, integer, integer) from public;
grant execute on function public.fn_ultimas_guardar(text, uuid, text, text, integer, integer) to anon, authenticated;

-- 5a) -----------------------------------------------------------------------
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

  -- parche 125: la última y penúltima pueden haberse fijado a mano.
  with arts as (
    select distinct r.area, upper(trim(r.articulo)) art
      from reclamos r
     where r.fecha = p_fecha and r.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or r.area = p_area)
  )
  select coalesce(json_agg(json_build_object('area', a.area, 'articulo', a.art, 'n1', u.n1, 'n2', u.n2)), '[]'::json)
    into v_ult
    from arts a join _ultimas(coalesce(p_area,'')) u on u.area = a.area and u.k = _nk(a.art);

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

-- 5b) -----------------------------------------------------------------------
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

  -- Base por artículo: total de la prenda y su última / penúltima (parche 125).
  with ba as (
    select b.articulo, min(b.modulo) modulo, sum(b.std) t_total, u.n1, u.n2
    from bases b join _ultimas(p_area) u on u.k = _nk(b.articulo)
    where b.area = p_area group by b.articulo, u.n1, u.n2
  ),
  -- PROD del área (KPI): siempre la ÚLTIMA operación, todo el área.
  notif_kpi as (
    select r.articulo, sum(r.cant) unidades, ba.t_total
    from reclamos r
    join ba on ba.articulo = r.articulo and r.nop = ba.n1
    join operarios op on op.dni = r.dni and op.cargo = 'OPERARIO'
    where r.area = p_area and r.fecha = hoy and r.estado = 'ACTIVO'
    group by r.articulo, ba.t_total
  ),
  -- ITEMS: según nivel (ultima|penultima) y módulo elegido.
  notif as (
    select r.articulo, r.o_f, r.modulo, sum(r.cant) unidades, ba.t_total
    from reclamos r
    join ba on ba.articulo = r.articulo
           and r.nop = case when v_off = 1 then ba.n2 else ba.n1 end
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

commit;
