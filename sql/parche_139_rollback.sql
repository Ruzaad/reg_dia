-- Deshace el parche 139: _min_salida, fn_ocurrencia_salida y fn_costos_reporte_dia vuelven a como estaban.
-- Los minutos recalculados de las salidas guardadas NO se revierten (eran el cálculo con refrigerio).
begin;

create or replace function public._min_salida(p_salida time, p_retorno time, p_confirmado boolean)
 returns numeric language sql immutable as $function$
  select greatest(0, round(extract(epoch from (
    case when p_retorno is not null and coalesce(p_confirmado,false)
         then least(p_retorno, time '18:20') else time '18:20' end
    - least(greatest(coalesce(p_salida, time '08:00'), time '08:00'), time '18:20')
  )) / 60));
$function$;

create or replace function public.fn_ocurrencia_salida(p_dni text, p_token uuid, p_dnis text[], p_area text, p_tipo text, p_salida time without time zone, p_retorno time without time zone)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; v_min numeric; n integer := 0; d text;
        v_est text; v_omit text[] := '{}';
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  if p_tipo not in ('SEGURO','PERMISO') then
    return json_build_object('ok',false,'error','Tipo no válido para salida'); end if;
  if p_salida is null then
    return json_build_object('ok',false,'error','Indica la hora de salida'); end if;
  if p_retorno is not null and p_retorno <= p_salida then
    return json_build_object('ok',false,'error','La hora de retorno debe ser posterior a la de salida'); end if;

  /* Sin confirmar todavía: se descuenta como si no volviera. */
  v_min := - _min_salida(p_salida, p_retorno, false);

  foreach d in array coalesce(p_dnis,'{}') loop
    -- Parche 53: no se registra una salida de un día que no se trabajó.
    v_est := _ausente_en(d, _hoy());
    if v_est is not null then
      v_omit := v_omit || (coalesce((select nombres_apellidos from operarios where dni = d), d)
                           || ' ('||v_est||')');
      continue;
    end if;
    insert into ocurrencias (dni, area, tipo, minutos, detalle, supervisora_dni,
                             hora_salida, hora_retorno, retorno_confirmado)
    values (d, p_area, p_tipo, v_min,
            'Salida '||to_char(p_salida,'HH24:MI')||
            coalesce(' · retorno previsto '||to_char(p_retorno,'HH24:MI'), ' · NO RETORNA'),
            s.dni, p_salida, p_retorno,
            case when p_retorno is null then null else false end);
    n := n + 1;
  end loop;

  if n = 0 then
    return json_build_object('ok', false, 'omitidos', to_json(v_omit),
      'error', 'Nadie de la selección está ACTIVO hoy. No se registró ninguna salida.');
  end if;
  return json_build_object('ok',true,'registradas',n,'minutos',v_min,
    'pendiente_confirmar', p_retorno is not null,
    'omitidos', to_json(v_omit), 'omitidos_n', coalesce(array_length(v_omit,1),0));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;


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


commit;
