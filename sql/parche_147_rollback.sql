-- ROLLBACK PARCHE 147 — vuelve a fn_pcp_resumen (parche 144) y a _pcp_seguimiento y el endpoint (parche 146).
begin;

create table if not exists public.pcp_api_claves (
  id bigserial primary key,
  nombre text not null,
  hash text not null unique,
  creada_por text references public.operarios(dni),
  creada_en timestamptz not null default now(),
  ultimo_uso timestamptz,
  activa boolean not null default true
);
comment on table public.pcp_api_claves is 'Claves del endpoint fn_pcp_api. Solo se guarda el hash SHA-256.';
alter table public.pcp_api_claves enable row level security;
revoke all on public.pcp_api_claves from anon, authenticated;

/* Núcleo del seguimiento. Sin permisos propios: lo llaman fn_pcp_seguimiento y fn_pcp_api. */
create or replace function public._pcp_seguimiento(p_mes date default null, p_of text default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare
  v_hoy date := _hoy(); v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_fin date;
  v_lab int; v_meta numeric; v_gantt json; v_cump json; v_res json; v_sem json; v_dias json; v_planes json;
begin
  v_fin := (v_mes + interval '1 month - 1 day')::date;
  select count(*) into v_lab from generate_series(v_mes, v_fin, '1 day') d where _laborable(d::date);
  v_meta := coalesce((select meta_minutos from metas_mes where mes = v_mes and alcance = 'CORPORACION'),
                     (select sum(meta_minutos) from metas_mes where mes = v_mes and alcance = 'AREA'), 0);

  /* Cumplimiento del cronograma: plan de corte y de inicio de costura contra lo real. */
  with cr as (
    select c.*,
           (select coalesce(sum(k.cantidad), 0) from pcp_corte k
             where (c.o_f is not null and k.o_f = c.o_f)
                or (c.o_f is null and k.articulo = c.articulo and k.fecha >= coalesce(c.ini_corte, v_mes) - 5)) cortado,
           (select min(k.fecha) from pcp_corte k
             where (c.o_f is not null and k.o_f = c.o_f)
                or (c.o_f is null and k.articulo = c.articulo and k.fecha >= coalesce(c.ini_corte, v_mes) - 5)) c_ini,
           (select max(k.fecha) from pcp_corte k
             where (c.o_f is not null and k.o_f = c.o_f)
                or (c.o_f is null and k.articulo = c.articulo and k.fecha >= coalesce(c.ini_corte, v_mes) - 5)) c_fin,
           (select min(r.fecha) from reclamos r
             where c.o_f is not null and r.o_f = c.o_f and r.estado = 'ACTIVO' and r.area like '%COSTURA'
               and r.fecha >= coalesce(c.ini_corte, v_hoy) - 30) s_ini,
           (select sum(r.minutos) from reclamos r
             where c.o_f is not null and r.o_f = c.o_f and r.estado = 'ACTIVO' and r.area like '%COSTURA'
               and r.fecha >= coalesce(c.ini_corte, v_hoy) - 30) s_min,
           (select sum(p.cant_prog * p.std) from pcp_programa p where c.o_f is not null and p.o_f = c.o_f) s_prog
      from pcp_cronograma c
     where p_of is null or c.o_f = p_of or c.articulo = upper(p_of)),
  e as (
    select cr.*,
      case when cortado >= cantidad and cantidad > 0 then (case when c_fin <= fin_corte then 'A TIEMPO' else 'TARDE' end)
           when fin_corte < v_hoy then 'ATRASADO'
           when ini_corte <= v_hoy then 'EN CURSO'
           else 'PENDIENTE' end e_corte,
      case when s_ini is not null then (case when s_ini <= ini_costura then 'A TIEMPO' else 'TARDE' end)
           when ini_costura >= v_hoy then 'PENDIENTE'
           when o_f is null then 'SIN OF'
           else 'SIN ARRANCAR' end e_cos
      from cr)
  select
    (select json_agg(json_build_object(
        'o_f', o_f, 'pedido', pedido, 'cliente', cliente, 'articulo', articulo, 'material', material, 'cantidad', cantidad,
        'ini_corte', ini_corte, 'fin_corte', fin_corte, 'ini_costura', ini_costura,
        'cortado', cortado, 'corte_ini_real', c_ini, 'corte_fin_real', case when cortado >= cantidad and cantidad > 0 then c_fin end,
        'costura_ini_real', s_ini, 'costura_avance', case when s_prog > 0 then round(least(1, coalesce(s_min, 0) / s_prog) * 100) end,
        'e_corte', e_corte, 'e_costura', e_cos,
        'falta_corte', ini_costura <= v_hoy and cortado < cantidad)
      order by o_f nulls last, articulo) from (select * from e limit 300) e2),
    (select json_build_object(
        'total', count(*),
        'corte_vencidos', count(*) filter (where fin_corte <= v_hoy),
        'corte_a_tiempo', count(*) filter (where fin_corte <= v_hoy and e_corte = 'A TIEMPO'),
        'corte_tarde', count(*) filter (where e_corte = 'TARDE'),
        'corte_atrasado', count(*) filter (where e_corte = 'ATRASADO'),
        'corte_en_curso', count(*) filter (where e_corte = 'EN CURSO'),
        'corte_pendiente', count(*) filter (where e_corte = 'PENDIENTE'),
        'costura_vencidos', count(*) filter (where ini_costura <= v_hoy and o_f is not null),
        'costura_a_tiempo', count(*) filter (where ini_costura <= v_hoy and e_cos = 'A TIEMPO'),
        'costura_tarde', count(*) filter (where e_cos = 'TARDE'),
        'costura_sin_arrancar', count(*) filter (where e_cos = 'SIN ARRANCAR'),
        'costura_sin_of', count(*) filter (where e_cos = 'SIN OF'),
        'costura_pendiente', count(*) filter (where e_cos = 'PENDIENTE'),
        'falta_corte', count(*) filter (where ini_costura <= v_hoy and cortado < cantidad)) from e)
    into v_cump, v_res;

  /* Gantt: OF del programa que arrancan costura (o ya arrancaron) sin corte completo, ordenadas por OF. */
  select json_agg(x order by x.o_f, x.articulo) into v_gantt from (
    select p.o_f, p.articulo, p.cliente, p.area, p.cant_prog, coalesce(k.cortado, 0) cortado,
           cr.ini_corte, cr.fin_corte, p.ini_costura, p.fin_costura, k.f_ini corte_ini_real, k.f_fin corte_fin_real, s.ini costura_ini_real,
           case when p.cant_prog * p.std > 0 then round(least(1, coalesce(s.mins, 0) / (p.cant_prog * p.std)) * 100) end costura_avance
      from pcp_programa p
      left join lateral (select c.ini_corte, c.fin_corte from pcp_cronograma c
                          where (c.o_f is not null and c.o_f = p.o_f) or (c.o_f is null and c.articulo = p.articulo)
                          order by (c.o_f is not null) desc limit 1) cr on true
      left join lateral (select sum(cantidad) cortado, min(fecha) f_ini, max(fecha) f_fin from pcp_corte where o_f = p.o_f) k on true
      left join lateral (select min(fecha) ini, sum(minutos) mins from reclamos r
                          where r.o_f = p.o_f and r.estado = 'ACTIVO' and r.area = p.area and r.fecha >= v_hoy - 120) s on true
     where p.o_f is not null and p.ini_costura between v_hoy - 15 and v_hoy + 10
       and coalesce(k.cortado, 0) < p.cant_prog
       and coalesce(upper(p.estatus), '') not like 'FINALIZ%'
       and (p_of is null or p.o_f = p_of)
     order by p.o_f, p.articulo limit 40) x;

  /* Semanas (lunes a domingo) del mes: compromiso = meta, demanda = programa por fin de costura, real = producido. */
  select json_agg(json_build_object('ini', a, 'fin', b, 'laborables', lab,
      'meta', case when v_lab > 0 then round(v_meta * lab / v_lab) else 0 end,
      'programa', round(coalesce((select sum(cant_prog * std) from pcp_programa where fin_costura between a and b), 0)),
      'real', round(coalesce((select sum(minutos) from reclamos where estado = 'ACTIVO' and fecha between a and b), 0)),
      'cerrada', b < v_hoy) order by a)
    into v_sem
    from (select greatest(ws, v_mes) a, least(ws + 6, v_fin) b,
                 (select count(*) from generate_series(greatest(ws, v_mes), least(ws + 6, v_fin), '1 day') d where _laborable(d::date)) lab
            from (select distinct date_trunc('week', d)::date ws from generate_series(v_mes, v_fin, '1 day') d) w) s;

  /* Días del mes: meta, disponible (MOD de la estructura × jornada), producido y personas. */
  select json_agg(json_build_object('f', g.d, 'lab', _laborable(g.d),
      'meta', case when _laborable(g.d) and v_lab > 0 then round(v_meta / v_lab) end,
      'disp', case when _laborable(g.d) then
                (select count(*) from estructura_mes e where e.mes = v_mes and e.tipo = 'MOD'
                    and (e.desde is null or e.desde <= g.d) and (e.hasta is null or e.hasta >= g.d)) * _jornada(g.d) end,
      'real', round(coalesce(p.m, 0)), 'personas', coalesce(p.pers, 0)) order by g.d)
    into v_dias
    from (select d::date d from generate_series(v_mes, v_fin, '1 day') d) g
    left join (select fecha, sum(minutos) m, count(distinct dni) pers from reclamos
                where fecha between v_mes and v_fin and estado = 'ACTIVO' group by fecha) p on p.fecha = g.d;

  select json_object_agg(tipo, json_build_object('archivo', archivo, 'filas', filas, 'desde', desde, 'hasta', hasta, 'cargado_en', cargado_en))
    into v_planes from pcp_cargas;

  return json_build_object('ok', true, 'mes', v_mes, 'hoy', v_hoy, 'laborables', v_lab, 'meta_mes', v_meta,
    'planes', coalesce(v_planes, '{}'::json), 'resumen', v_res, 'cronograma', coalesce(v_cump, '[]'::json),
    'gantt', coalesce(v_gantt, '[]'::json), 'semanas', coalesce(v_sem, '[]'::json), 'dias', coalesce(v_dias, '[]'::json));
end $function$;
revoke all on function public._pcp_seguimiento(date, text) from public, anon, authenticated;


/* Endpoint para PCP: POST /rest/v1/rpc/fn_pcp_api con {"p_clave": "...", "p_mes": "2026-10-01", "p_of": "4000010570"}. */
create or replace function public.fn_pcp_api(p_clave text, p_mes date default null, p_of text default null)
 returns json language plpgsql volatile security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare v_id bigint;
begin
  select id into v_id from pcp_api_claves
   where activa and hash = encode(sha256(convert_to(coalesce(p_clave, ''), 'UTF8')), 'hex');
  if v_id is null then raise exception 'CLAVE_INVALIDA: la clave no existe o fue revocada'; end if;
  update pcp_api_claves set ultimo_uso = now() where id = v_id;
  return _pcp_seguimiento(p_mes, nullif(trim(p_of), ''));
end $function$;

create or replace function public.fn_pcp_api_clave_crear(p_dni text, p_token uuid, p_nombre text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_clave text; v_id bigint;
begin
  o := _pcp_editor(p_dni, p_token);
  if nullif(trim(p_nombre), '') is null then return json_build_object('ok', false, 'error', 'Ponle un nombre a la clave'); end if;
  v_clave := 'pcp_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into pcp_api_claves (nombre, hash, creada_por)
  values (left(trim(p_nombre), 80), encode(sha256(convert_to(v_clave, 'UTF8')), 'hex'), o.dni) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'clave', v_clave);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_pcp_api_claves(p_dni text, p_token uuid)
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _pcp_editor(p_dni, p_token);
  return json_build_object('ok', true, 'claves', coalesce((select json_agg(json_build_object('id', id, 'nombre', nombre,
      'creada_en', creada_en, 'ultimo_uso', ultimo_uso, 'activa', activa) order by creada_en desc) from pcp_api_claves), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_pcp_api_clave_revocar(p_dni text, p_token uuid, p_id bigint)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _pcp_editor(p_dni, p_token);
  update pcp_api_claves set activa = false where id = p_id;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;


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

drop function if exists public._pcp_prod(date, date);
drop function if exists public._of_planta(text);

commit;
