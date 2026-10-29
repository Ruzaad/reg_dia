-- PARCHE 146 — PCP: cronograma de corte (PDF), seguimiento (Gantt, semanal, diario) y endpoint para PCP
-- 1) pcp_cronograma: el cronograma de corte que sube PCP en PDF (OF, artículo, fechas de corte e inicio de costura).
--    Solo la versión vigente: subir otro reemplaza al anterior.
-- 2) _pcp_seguimiento(mes, OF): cumplimiento del cronograma (corte y costura contra lo real), Gantt por OF de lo
--    que arranca costura sin corte completo, minutaje semanal (meta, programa y real) y minutaje/eficiencia diaria.
-- 3) fn_pcp_seguimiento (pantalla, con sesión) y fn_pcp_api (endpoint para PCP, con clave propia) usan la misma función.
--    Las claves se guardan solo como hash; se muestran una vez al crearlas y se pueden revocar.
-- No se toca ninguna RPC existente. Rollback: parche_146_rollback.sql
begin;

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.pcp_cargas'::regclass and contype = 'c' loop
    execute format('alter table public.pcp_cargas drop constraint %I', c);
  end loop;
end $$;
alter table public.pcp_cargas add constraint pcp_cargas_tipo_check check (tipo in ('PROGRAMA','CORTE','CRONOGRAMA'));

create table if not exists public.pcp_cronograma (
  id bigserial primary key,
  pedido text, cliente text, o_f text, articulo text, material text,
  cantidad numeric not null default 0,
  ini_corte date, fin_corte date, ini_costura date, observacion text
);
comment on table public.pcp_cronograma is 'Cronograma de corte vigente (PDF de PCP). o_f null = «SIN OF»: se cruza por artículo.';
create index if not exists pcp_cronograma_of_idx on public.pcp_cronograma (o_f);
create index if not exists pcp_cronograma_art_idx on public.pcp_cronograma (articulo);
alter table public.pcp_cronograma enable row level security;
revoke all on public.pcp_cronograma from anon, authenticated;

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

create or replace function public.fn_pcp_cronograma_cargar(p_dni text, p_token uuid, p_archivo text, p_filas jsonb)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare o operarios; v_n int;
begin
  o := _pcp_editor(p_dni, p_token);
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'El PDF no trae filas de cronograma');
  end if;
  if jsonb_array_length(p_filas) > 2000 then
    return json_build_object('ok', false, 'error', 'Máximo 2000 filas por cronograma');
  end if;
  delete from pcp_cronograma where true;
  insert into pcp_cronograma (pedido, cliente, o_f, articulo, material, cantidad, ini_corte, fin_corte, ini_costura, observacion)
  select nullif(trim(x->>'pedido'), ''), nullif(trim(x->>'cliente'), ''), nullif(trim(x->>'of'), ''),
         upper(trim(x->>'articulo')), nullif(trim(x->>'material'), ''), coalesce(nullif(x->>'cantidad', '')::numeric, 0),
         nullif(x->>'ini_corte', '')::date, nullif(x->>'fin_corte', '')::date, nullif(x->>'ini_costura', '')::date,
         nullif(trim(x->>'obs'), '')
    from jsonb_array_elements(p_filas) x
   where nullif(trim(x->>'articulo'), '') is not null;
  get diagnostics v_n = row_count;
  insert into pcp_cargas (tipo, archivo, filas, desde, hasta, cargado_por, cargado_en)
  select 'CRONOGRAMA', left(p_archivo, 200), v_n, min(ini_corte), max(ini_costura), o.dni, now() from pcp_cronograma
  on conflict (tipo) do update set archivo = excluded.archivo, filas = excluded.filas, desde = excluded.desde,
    hasta = excluded.hasta, cargado_por = excluded.cargado_por, cargado_en = excluded.cargado_en;
  return json_build_object('ok', true, 'filas', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

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

create or replace function public.fn_pcp_seguimiento(p_dni text, p_token uuid, p_mes date default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
begin
  perform _vista(p_dni, p_token, array['pasoPcp']);
  return _pcp_seguimiento(p_mes, null);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

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

commit;
