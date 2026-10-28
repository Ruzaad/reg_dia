-- PARCHE 144 — PCP en CHRONOS: meta del mes por área, programa de costura y salida de corte
-- 1) pcp_cargas, pcp_programa (programa de costura que sube PCP en Excel) y pcp_corte (hoja NOTI_CORTE:
--    lo que SALE de corte por día y OF). Solo se guarda la versión vigente: subir otro programa reemplaza
--    al anterior, y subir corte reemplaza solo las fechas que trae el archivo. Nada crece sin control.
-- 2) La meta del mes vive en metas_mes (parche 130), que estaba vacía: CORPORACION y una por AREA.
--    Meta del día del área = meta del mes ÷ días laborables del mes (_laborable).
--    Meta del día de una persona = su jornada (_jornada) × (meta del día del área ÷ minutos disponibles
--    del área), y los disponibles salen de la estructura del mes (MOD activos × _jornada).
-- 3) fn_pcp_resumen (lectura, pestaña pasoPcp), fn_pcp_meta_guardar, fn_pcp_programa_cargar,
--    fn_pcp_corte_cargar y fn_mi_meta (celular del operario). No se toca ninguna RPC existente.
-- Rollback: parche_144_rollback.sql
begin;

create table if not exists public.pcp_cargas (
  tipo text primary key check (tipo in ('PROGRAMA','CORTE')),
  archivo text,
  filas int not null default 0,
  desde date,
  hasta date,
  cargado_por text references public.operarios(dni),
  cargado_en timestamptz not null default now()
);
comment on table public.pcp_cargas is 'Última carga de PCP por tipo (PROGRAMA de costura, CORTE = hoja NOTI_CORTE).';
alter table public.pcp_cargas enable row level security;
revoke all on public.pcp_cargas from anon, authenticated;

create table if not exists public.pcp_programa (
  id bigserial primary key,
  area text not null,
  planta text, linea text, prenda text, cliente text, pedido text,
  articulo text, modelo text, color text, o_f text,
  cant numeric, cant_prog numeric not null default 0, std numeric not null default 0,
  ini_costura date, fin_costura date,
  mes int, anio int, estatus text, observacion text
);
comment on table public.pcp_programa is 'Programa de costura vigente (Excel de PCP). Minutos programados = cant_prog × std.';
create index if not exists pcp_programa_mes_idx on public.pcp_programa (anio, mes, area);
create index if not exists pcp_programa_of_idx on public.pcp_programa (o_f);
alter table public.pcp_programa enable row level security;
revoke all on public.pcp_programa from anon, authenticated;

create table if not exists public.pcp_corte (
  id bigserial primary key,
  fecha date not null,
  o_f text,
  articulo text,
  color text,
  cliente text,
  cantidad numeric not null default 0
);
comment on table public.pcp_corte is 'Salida de CORTE (hoja NOTI_CORTE): prendas cortadas por día y OF, disponibles para costura.';
create index if not exists pcp_corte_fecha_idx on public.pcp_corte (fecha);
create index if not exists pcp_corte_of_idx on public.pcp_corte (o_f);
alter table public.pcp_corte enable row level security;
revoke all on public.pcp_corte from anon, authenticated;

/* Quién puede cargar PCP: el administrador o quien edita alguna área y tiene la pestaña. */
create or replace function public._pcp_editor(p_dni text, p_token uuid)
 returns operarios language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  if not (coalesce(o.es_admin, false) or exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR')) then
    raise exception 'NO_AUTORIZADA: solo lectura en PCP';
  end if;
  return o;
end $function$;

/* Meta del día de un área en una fecha y sus minutos disponibles (estructura del mes). */
create or replace function public._pcp_meta_area(p_area text, p_fecha date)
 returns table (meta_dia numeric, disponible numeric, personas int)
 language sql stable security definer set search_path to 'public'
as $$
  with m as (select date_trunc('month', p_fecha)::date mes),
  lab as (select count(*) n from m, generate_series(m.mes, (m.mes + interval '1 month - 1 day')::date, '1 day') d
           where _laborable(d::date)),
  per as (select count(*)::int n from m join estructura_mes e on e.mes = m.mes
           where e.area = p_area and e.tipo = 'MOD'
             and (e.desde is null or e.desde <= p_fecha) and (e.hasta is null or e.hasta >= p_fecha))
  select case when lab.n > 0 and _laborable(p_fecha) then round(mm.meta_minutos / lab.n) end,
         per.n * _jornada(p_fecha), per.n
    from m cross join lab cross join per
    left join metas_mes mm on mm.mes = m.mes and mm.alcance = 'AREA' and mm.area = p_area
$$;

create or replace function public.fn_pcp_resumen(p_dni text, p_token uuid, p_mes date default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare
  o operarios; v_hoy date := _hoy(); v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_fin date;
  v_lab int; v_trans int; v_jor numeric; v_puede boolean; v_areas json; v_prog json; v_venc json; v_arr json; v_corte json; v_cargas json;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  v_fin := (v_mes + interval '1 month - 1 day')::date;
  v_puede := coalesce(o.es_admin, false) or exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR');
  select count(*), count(*) filter (where d::date < v_hoy), coalesce(max(_jornada(d::date)), 0) into v_lab, v_trans, v_jor
    from generate_series(v_mes, v_fin, '1 day') d where _laborable(d::date);

  with prod as (
    select area, fecha, sum(minutos) mins, count(distinct dni) pers
      from reclamos where fecha between v_mes and v_fin and estado = 'ACTIVO'
     group by area, fecha),
  est as (
    select area, count(*) filter (where tipo = 'MOD' and (hasta is null or hasta >= least(v_hoy, v_fin))) mod
      from estructura_mes where mes = v_mes group by area),
  met as (select area, meta_minutos from metas_mes where mes = v_mes and alcance = 'AREA'),
  ar as (
    select area from est where mod > 0
    union select area from met
    union select area from prod)
  select json_agg(json_build_object(
      'area', ar.area,
      'personas', coalesce(est.mod, 0),
      'disponible_dia', coalesce(est.mod, 0) * v_jor,
      'meta_mes', met.meta_minutos,
      'meta_dia', case when v_lab > 0 then round(met.meta_minutos / v_lab) end,
      'producido', coalesce((select sum(mins) from prod p where p.area = ar.area), 0),
      'producido_hoy', coalesce((select sum(mins) from prod p where p.area = ar.area and p.fecha = v_hoy), 0),
      'dias', (select json_agg(json_build_object('f', p.fecha, 'm', round(p.mins), 'p', p.pers) order by p.fecha)
                 from prod p where p.area = ar.area))
    order by ar.area)
    into v_areas
    from ar left join est using (area) left join met using (area);

  with pr as (
    select area, sum(cant_prog * std) prog,
           sum(cant_prog * std) filter (where fin_costura < v_hoy) debia,
           sum(cant_prog) prendas, count(*) filas
      from pcp_programa
     where anio = extract(year from v_mes) and mes = extract(month from v_mes)
     group by area)
  select json_agg(json_build_object('area', area, 'programa', round(prog), 'debia', round(coalesce(debia, 0)),
                                    'prendas', prendas, 'filas', filas) order by area)
    into v_prog from pr;

  with cor as (select o_f, sum(cantidad) cortado from pcp_corte where o_f is not null group by o_f),
  p as (
    select pp.*, coalesce(c.cortado, 0) cortado
      from pcp_programa pp left join cor c on c.o_f = pp.o_f)
  select
    (select json_agg(x) from (
       select area, o_f, articulo, cliente, round(cant_prog * std) minutos, fin_costura fin, cant_prog, cortado
         from p
        where fin_costura < v_hoy and fin_costura >= v_mes - 60
          and coalesce(upper(estatus), '') not like 'FINALIZ%'
        order by cant_prog * std desc limit 25) x),
    (select json_agg(x) from (
       select area, o_f, articulo, cliente, ini_costura ini, fin_costura fin, cant_prog, cortado
         from p
        where ini_costura between v_hoy - 3 and v_hoy + 10 and o_f is not null and cortado < cant_prog
          and coalesce(upper(estatus), '') not like 'FINALIZ%'
        order by ini_costura, cant_prog - cortado desc limit 30) x)
    into v_venc, v_arr;

  select json_build_object(
      'dias', (select json_agg(json_build_object('f', fecha, 'c', c) order by fecha)
                 from (select fecha, sum(cantidad) c from pcp_corte where fecha between v_mes and v_fin group by fecha) d),
      'total', (select coalesce(sum(cantidad), 0) from pcp_corte where fecha between v_mes and v_fin),
      'ofs', (select json_agg(x) from (
                select o_f, max(articulo) articulo, max(cliente) cliente, sum(cantidad) cantidad, max(fecha) ultima
                  from pcp_corte where fecha between v_mes - 15 and v_fin
                 group by o_f order by max(fecha) desc, sum(cantidad) desc limit 40) x))
    into v_corte;

  select json_object_agg(tipo, json_build_object('archivo', archivo, 'filas', filas, 'desde', desde, 'hasta', hasta,
           'por', (select nombres_apellidos from operarios where dni = c.cargado_por), 'en', cargado_en))
    into v_cargas from pcp_cargas c;

  return json_build_object('ok', true, 'mes', v_mes, 'hoy', v_hoy, 'laborables', v_lab, 'transcurridos', v_trans,
    'hoy_laborable', _laborable(v_hoy) and v_hoy between v_mes and v_fin, 'puede_editar', v_puede,
    'meta_corp', (select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION'),
    'areas', coalesce(v_areas, '[]'::json), 'programa', coalesce(v_prog, '[]'::json),
    'vencidas', coalesce(v_venc, '[]'::json), 'arranque', coalesce(v_arr, '[]'::json),
    'corte', v_corte, 'cargas', coalesce(v_cargas, '{}'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* p_metas: [{"alcance":"CORPORACION"|"AREA","area":"...","meta_minutos":123}]; vacío o 0 borra esa meta. */
create or replace function public.fn_pcp_meta_guardar(p_dni text, p_token uuid, p_mes date, p_metas jsonb)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_mes date := date_trunc('month', p_mes)::date; x jsonb; v_al text; v_ar text; v_m numeric; v_n int := 0;
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
    delete from metas_mes where mes = v_mes and alcance = v_al and area is not distinct from v_ar and dni is null;
    if coalesce(v_m, 0) > 0 then
      insert into metas_mes (mes, alcance, area, meta_minutos, cargado_por) values (v_mes, v_al, v_ar, round(v_m), o.dni);
    end if;
    v_n := v_n + 1;
  end loop;
  return json_build_object('ok', true, 'guardadas', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* Reemplaza el programa de costura vigente por el del archivo. */
create or replace function public.fn_pcp_programa_cargar(p_dni text, p_token uuid, p_archivo text, p_filas jsonb)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare o operarios; v_n int;
begin
  o := _pcp_editor(p_dni, p_token);
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'El archivo no trae filas de programa');
  end if;
  if jsonb_array_length(p_filas) > 5000 then
    return json_build_object('ok', false, 'error', 'Máximo 5000 filas por programa');
  end if;
  delete from pcp_programa;
  insert into pcp_programa (area, planta, linea, prenda, cliente, pedido, articulo, modelo, color, o_f,
                            cant, cant_prog, std, ini_costura, fin_costura, mes, anio, estatus, observacion)
  select upper(trim(x->>'area')), x->>'planta', x->>'linea', x->>'prenda', x->>'cliente', x->>'pedido',
         upper(trim(x->>'articulo')), x->>'modelo', x->>'color', nullif(trim(x->>'of'), ''),
         nullif(x->>'cant', '')::numeric, coalesce(nullif(x->>'cant_prog', '')::numeric, 0),
         coalesce(nullif(x->>'std', '')::numeric, 0),
         nullif(x->>'ini', '')::date, nullif(x->>'fin', '')::date,
         nullif(x->>'mes', '')::int, nullif(x->>'anio', '')::int,
         nullif(trim(x->>'estatus'), ''), nullif(trim(x->>'obs'), '')
    from jsonb_array_elements(p_filas) x
   where nullif(trim(x->>'area'), '') is not null;
  get diagnostics v_n = row_count;
  insert into pcp_cargas (tipo, archivo, filas, desde, hasta, cargado_por, cargado_en)
  select 'PROGRAMA', left(p_archivo, 200), v_n, min(ini_costura), max(fin_costura), o.dni, now() from pcp_programa
  on conflict (tipo) do update set archivo = excluded.archivo, filas = excluded.filas, desde = excluded.desde,
    hasta = excluded.hasta, cargado_por = excluded.cargado_por, cargado_en = excluded.cargado_en;
  return json_build_object('ok', true, 'filas', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* Salida de corte (NOTI_CORTE): reemplaza solo las fechas que trae el archivo. */
create or replace function public.fn_pcp_corte_cargar(p_dni text, p_token uuid, p_origen text, p_filas jsonb)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare o operarios; v_n int; v_d date; v_h date;
begin
  o := _pcp_editor(p_dni, p_token);
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'No hay filas de corte con fecha y cantidad');
  end if;
  if jsonb_array_length(p_filas) > 20000 then
    return json_build_object('ok', false, 'error', 'Máximo 20000 filas por carga: elige un rango de fechas más corto');
  end if;
  select min((x->>'fecha')::date), max((x->>'fecha')::date) into v_d, v_h from jsonb_array_elements(p_filas) x;
  delete from pcp_corte where fecha between v_d and v_h;
  insert into pcp_corte (fecha, o_f, articulo, color, cliente, cantidad)
  select (x->>'fecha')::date, nullif(trim(x->>'of'), ''), upper(trim(x->>'articulo')), nullif(trim(x->>'color'), ''),
         nullif(trim(x->>'cliente'), ''), (x->>'cantidad')::numeric
    from jsonb_array_elements(p_filas) x
   where nullif(x->>'fecha', '') is not null and coalesce(nullif(x->>'cantidad', '')::numeric, 0) <> 0;
  get diagnostics v_n = row_count;
  insert into pcp_cargas (tipo, archivo, filas, desde, hasta, cargado_por, cargado_en)
  values ('CORTE', left(p_origen, 300), v_n, v_d, v_h, o.dni, now())
  on conflict (tipo) do update set archivo = excluded.archivo, filas = excluded.filas, desde = excluded.desde,
    hasta = excluded.hasta, cargado_por = excluded.cargado_por, cargado_en = excluded.cargado_en;
  return json_build_object('ok', true, 'filas', v_n, 'desde', v_d, 'hasta', v_h);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* Celular: la meta de hoy de quien entra. Sin meta del área devuelve meta null y el celular no muestra nada. */
create or replace function public.fn_mi_meta(p_dni text, p_token uuid)
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
declare o operarios; v_hoy date := _hoy(); v_area text; v_pers numeric; m record; v_meta numeric;
begin
  o := _auth(p_dni, p_token);
  select e.area into v_area from estructura_mes e
   where e.mes = date_trunc('month', v_hoy)::date and e.dni = o.dni and e.tipo = 'MOD';
  v_area := coalesce(v_area, o.area_origen, o.area_actual);
  select mm.meta_minutos / nullif((select count(*) from generate_series(date_trunc('month', v_hoy), date_trunc('month', v_hoy) + interval '1 month - 1 day', '1 day') d
                                     where _laborable(d::date)), 0)
    into v_pers from metas_mes mm
   where mm.mes = date_trunc('month', v_hoy)::date and mm.alcance = 'OPERARIO' and mm.dni = o.dni;
  if v_pers is not null then
    v_meta := case when _laborable(v_hoy) then round(v_pers) end;
    return json_build_object('ok', true, 'area', v_area, 'meta', v_meta, 'fuente', 'PERSONAL');
  end if;
  select * into m from _pcp_meta_area(v_area, v_hoy);
  if m.meta_dia is null or coalesce(m.disponible, 0) = 0 then
    return json_build_object('ok', true, 'area', v_area, 'meta', null);
  end if;
  v_meta := round(_jornada(v_hoy) * m.meta_dia / m.disponible);
  return json_build_object('ok', true, 'area', v_area, 'meta', v_meta, 'fuente', 'AREA',
    'eficiencia_meta', round(m.meta_dia / m.disponible * 100), 'meta_area', m.meta_dia, 'personas', m.personas);
end $function$;

revoke all on function public._pcp_editor(text, uuid) from public, anon, authenticated;
revoke all on function public._pcp_meta_area(text, date) from public, anon, authenticated;
grant execute on function public.fn_pcp_resumen(text, uuid, date) to anon, authenticated;
grant execute on function public.fn_pcp_meta_guardar(text, uuid, date, jsonb) to anon, authenticated;
grant execute on function public.fn_pcp_programa_cargar(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.fn_pcp_corte_cargar(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.fn_mi_meta(text, uuid) to anon, authenticated;

commit;
