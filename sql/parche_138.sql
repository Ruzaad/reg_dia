-- PARCHE 138 — Costos › Reporte de hoy con todo lo que pasa por producción
-- Problema: Costos necesita ver, por día, dónde trabajó cada persona (según la estructura del mes
-- contra el área de sus tickets), la producción por OF / artículo / prenda con su S.A.M y el
-- detalle por operación. fn_costos_reporte solo trae tickets agrupados y no dice dónde trabajó
-- la gente.
-- Cambio: RPC nueva fn_costos_reporte_dia, de solo lectura (_lector). La jornada de cada persona
-- sale de _disp_reparto (la misma regla de la eficiencia): si solo tiene tickets en otra área, sus
-- minutos van completos a esa área; si registró en dos, se reparten según lo producido.
-- fn_costos_reporte se queda igual para los despliegues viejos.
-- Rollback: parche_138_rollback.sql
begin;

create or replace function public.fn_costos_reporte_dia(p_dni text, p_token uuid, p_fecha date, p_area text default '')
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_tk json; v_ult json; v_sam json; v_per json; v_est json; v_inc json;
  v_area text := coalesce(p_area,'');
  v_mes date := date_trunc('month', p_fecha)::date;
begin
  perform _lector(p_dni, p_token, v_area);
  if p_fecha is null then raise exception 'Indica la fecha'; end if;

  -- Tickets por área / artículo / OF / operación.
  with _crd_tk as (select r.dni, r.area, upper(trim(r.articulo)) art, r.o_f, r.op, r.nop, r.std, r.cant, r.minutos
                     from reclamos r where r.fecha = p_fecha and r.estado = 'ACTIVO')
  select coalesce(json_agg(json_build_object('area', t.area, 'articulo', t.art, 'of', t.o_f,
           'prenda', o.prenda, 'op', t.op, 'nop', t.nop, 'std', t.std, 'cant', t.cant,
           'minutos', t.minutos, 'tks', t.tks, 'personas', t.pers)), '[]'::json)
    into v_tk
    from (select area, art, o_f, op, nop, round(max(std)::numeric, 4) std, sum(cant) cant,
                 round(sum(minutos)::numeric, 2) minutos, count(*) tks, count(distinct dni) pers
            from _crd_tk where v_area = '' or area = v_area
           group by 1,2,3,4,5) t
    left join ofs o on o.o_f = t.o_f;

  -- Última y penúltima (parche 125) y S.A.M de cada artículo en su área.
  with _crd_tk as (select r.dni, r.area, upper(trim(r.articulo)) art, r.o_f, r.op, r.nop, r.std, r.cant, r.minutos
                     from reclamos r where r.fecha = p_fecha and r.estado = 'ACTIVO')
  , arts as (select distinct area, art from _crd_tk where v_area = '' or area = v_area)
  select coalesce(json_agg(json_build_object('area', a.area, 'articulo', a.art, 'n1', u.n1, 'n2', u.n2)), '[]'::json)
    into v_ult
    from arts a join _ultimas(v_area) u on u.area = a.area and u.k = _nk(a.art);

  with _crd_tk as (select r.dni, r.area, upper(trim(r.articulo)) art, r.o_f, r.op, r.nop, r.std, r.cant, r.minutos
                     from reclamos r where r.fecha = p_fecha and r.estado = 'ACTIVO')
  , arts as (select distinct area, art from _crd_tk where v_area = '' or area = v_area)
  select coalesce(json_agg(json_build_object('area', s.area, 'articulo', s.art, 'sam', s.sam)), '[]'::json)
    into v_sam
    from (select a.area, a.art, round(sum(b.std)::numeric, 2) sam
            from arts a join bases b on b.area = a.area and upper(trim(b.articulo)) = a.art
           group by 1,2) s;

  -- Personal con tickets: área de la estructura del mes contra el área donde trabajó.
  with _crd_tk as (select r.dni, r.area, upper(trim(r.articulo)) art, r.o_f, r.op, r.nop, r.std, r.cant, r.minutos
                     from reclamos r where r.fecha = p_fecha and r.estado = 'ACTIVO')
  , prod as (
    select dni, area, sum(minutos) mins from _crd_tk group by 1,2
  ),
  est as (
    select distinct on (e.dni) e.dni, e.area, e.cargo, e.nombre
      from estructura_mes e where e.mes = v_mes
     order by e.dni, e.actualizado desc nulls last
  ),
  rep as (
    select d.dni, d.area, d.minutos, d.modo from _disp_reparto(p_fecha) d
     where exists (select 1 from prod p where p.dni = d.dni)
  ),
  filas as (
    select coalesce(p.dni, r.dni) dni, coalesce(p.area, r.area) area,
           coalesce(p.mins, 0) mins, coalesce(r.minutos, 0) jornada,
           max(r.modo) over (partition by coalesce(p.dni, r.dni)) modo
      from prod p full join rep r on r.dni = p.dni and r.area = p.area
  )
  select coalesce(json_agg(json_build_object(
           'nombre', coalesce(e.nombre, o.nombres_apellidos), 'cargo', coalesce(e.cargo, o.cargo),
           'area_est', coalesce(e.area, o.area_origen), 'area', f.area,
           'minutos', round(f.mins::numeric, 1), 'jornada', round(f.jornada::numeric, 1), 'modo', f.modo)), '[]'::json)
    into v_per
    from filas f join operarios o on o.dni = f.dni left join est e on e.dni = f.dni
   where f.area is not null
     and (v_area = '' or f.area = v_area or coalesce(e.area, o.area_origen) = v_area);

  select coalesce(json_agg(json_build_object('area', x.area, 'personas', x.n)), '[]'::json)
    into v_est
    from (select e.area, count(*) n from estructura_mes e
           where e.mes = v_mes and (e.hasta is null or e.hasta >= p_fecha) and (e.desde is null or e.desde <= p_fecha)
             and (v_area = '' or e.area = v_area)
           group by 1) x;

  select coalesce(json_agg(json_build_object(
      'nombre', o.nombres_apellidos, 'area', oc.area, 'tipo', oc.tipo,
      'minutos', oc.minutos, 'detalle', oc.detalle,
      'hora', to_char(oc.creado at time zone 'America/Lima','HH24:MI'))
      order by oc.area, oc.creado), '[]'::json)
    into v_inc
    from ocurrencias oc join operarios o on o.dni = oc.dni
   where oc.fecha = p_fecha and (v_area = '' or oc.area = v_area);

  return json_build_object('ok', true, 'fecha', to_char(p_fecha,'YYYY-MM-DD'),
    'tickets', v_tk, 'ultimas', v_ult, 'sam', v_sam, 'personal', v_per,
    'estructura', v_est, 'incidencias', v_inc);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_costos_reporte_dia(text, uuid, date, text) to anon, authenticated;

commit;
