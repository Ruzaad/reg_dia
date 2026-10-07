-- PARCHE 104 — Estudios de tiempos: base madre de operaciones y toma de tiempos
--
-- El aplicativo de estudios de tiempos (repo estudios-tiempos) deja el Google
-- Sheet y guarda aquí, con el mismo usuario y PIN de Samitex. Con eso:
--
--   · `tiempos_operaciones` es la BASE MADRE: una operación por área, aunque
--     se repita en muchos artículos. Las mediciones cuelgan de ella, así que
--     medir "PEGAR BOLSILLO" una vez sirve para todos los artículos del área.
--   · `tiempos_estudios` + `tiempos_ciclos` + `tiempos_inconvenientes` guardan
--     cada medición tal como la tomó el analista (cronómetro o conteo).
--   · El estándar de la operación es el TN más bajo entre los operarios
--     medidos (regla del mejor operario calificado), por método; el conteo no
--     compite con el cronómetro, y lo tomado en simultáneo nace sin competir.
--   · Ingeniería compara ese estándar con el STD de la BASE y, si quiere, lo
--     aplica con un botón. Aplicar exige EDITAR en el área y queda en
--     `bases_log` con origen ESTUDIO.
--
-- No toca tickets, reclamos, eficiencias ni ninguna función existente salvo
-- el trigger de bases_log, que solo suma dos columnas nuevas.
--
-- Re-ejecutable. Vuelta atrás: sql/parche_104_rollback.sql.
begin;

-- ---------- 1. Normalización de nombres de operación ----------
-- Dos artículos escriben la misma operación con distinto espaciado o tildes.
-- La clave normalizada es lo que las une en la base madre.
create or replace function public._tmp_norm(p text)
returns text language sql immutable
as $$
  select nullif(regexp_replace(
           upper(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')),
           '[^A-Z0-9]+', ' ', 'g'), ' ')
$$;
-- trim() aparte: regexp_replace deja un espacio en los bordes.
create or replace function public._tmp_clave(p text)
returns text language sql immutable
as $$ select trim(coalesce(_tmp_norm(p), '')) $$;

-- ---------- 2. Base madre de operaciones ----------
create table if not exists public.tiempos_operaciones (
  id        bigserial primary key,
  area      text not null,
  clave     text not null,              -- nombre normalizado, une los artículos
  nombre    text not null,              -- como se escribe en la BASE
  postura   text not null default 'sentado' check (postura in ('pie','sentado')),
  maquina   text,
  activa    boolean not null default true,
  creado    timestamptz not null default now(),
  creado_por text
);
create unique index if not exists tiempos_operaciones_uq on public.tiempos_operaciones (area, clave);
alter table public.tiempos_operaciones enable row level security;
revoke all on public.tiempos_operaciones from anon, authenticated;

-- Un estudio: un operario, una operación, un método, un día.
create table if not exists public.tiempos_estudios (
  id            uuid primary key,       -- lo genera el dispositivo: reenviar no duplica
  op_id         bigint not null references public.tiempos_operaciones(id) on delete cascade,
  area          text not null,
  articulo      text not null default '',   -- vacío: medido sin artículo
  operacion     text not null,
  dni_analista  text not null,
  dni_operario  text,
  nombre_operario text,
  fecha         date not null,
  metodo        text not null check (metodo in ('CRONOMETRO','CONTEO')),
  modo          text not null default 'INDIVIDUAL' check (modo in ('INDIVIDUAL','SIMULTANEO')),
  sesion_id     uuid,
  -- Lo tomado en simultáneo no compite por el estándar salvo que el analista
  -- lo habilite: con varios carriles no se llega a tiempo a cada toque y el
  -- estándar es el TN más bajo, así que un tiempo tardío desplazaría al bueno.
  compite       boolean not null default true,
  n_ciclos      integer not null default 0,
  n_anulados    integer not null default 0,
  duracion_seg  numeric,                -- conteo
  prendas       integer,                -- conteo
  valoracion    numeric,                -- conteo
  tn_min        numeric not null,
  suplemento_pct numeric not null,
  te_min        numeric not null,
  dispersion_cv numeric not null default 0,
  observacion   text,
  dispositivo   text,
  creado        timestamptz not null default now()
);
create index if not exists tiempos_estudios_op_idx on public.tiempos_estudios (op_id, metodo);
create index if not exists tiempos_estudios_area_idx on public.tiempos_estudios (area, fecha);
alter table public.tiempos_estudios enable row level security;
revoke all on public.tiempos_estudios from anon, authenticated;

create table if not exists public.tiempos_ciclos (
  estudio_id  uuid not null references public.tiempos_estudios(id) on delete cascade,
  n_ciclo     integer not null,
  tiempo_seg  numeric not null,
  valoracion  numeric not null,
  valido      boolean not null default true,
  observacion text,
  primary key (estudio_id, n_ciclo)
);
alter table public.tiempos_ciclos enable row level security;
revoke all on public.tiempos_ciclos from anon, authenticated;

create table if not exists public.tiempos_inconvenientes (
  id          bigserial primary key,
  estudio_id  uuid not null references public.tiempos_estudios(id) on delete cascade,
  n_ciclo     integer not null default 0,
  tipo        text not null,
  duracion_seg numeric not null default 0,
  anulo_ciclo boolean not null default false,
  momento_seg numeric not null default 0,
  comentario  text
);
create index if not exists tiempos_inconv_est_idx on public.tiempos_inconvenientes (estudio_id);
alter table public.tiempos_inconvenientes enable row level security;
revoke all on public.tiempos_inconvenientes from anon, authenticated;

-- ---------- 3. bases_log: de dónde vino el cambio ----------
alter table public.bases_log add column if not exists origen text not null default 'MANUAL';
alter table public.bases_log add column if not exists estudio_id uuid;

-- Igual que el del parche 86; solo agrega el origen, que viaja en app.origen.
create or replace function public._bases_log_trg()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_dni text := coalesce(nullif(current_setting('app.dni', true), ''), 'SISTEMA');
  v_org text := coalesce(nullif(current_setting('app.origen', true), ''), 'MANUAL');
  v_est uuid := nullif(current_setting('app.estudio', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    insert into bases_log (dni, accion, area, articulo, modulo, n_op, operacion, std_antes, std_despues, origen, estudio_id)
    values (v_dni, 'AGREGADA', new.area, new.articulo, new.modulo, new.n_op, new.operacion, null, new.std, v_org, v_est);
  elsif tg_op = 'DELETE' then
    insert into bases_log (dni, accion, area, articulo, modulo, n_op, operacion, std_antes, std_despues, origen, estudio_id)
    values (v_dni, 'BORRADA', old.area, old.articulo, old.modulo, old.n_op, old.operacion, old.std, null, v_org, v_est);
  elsif new.std is distinct from old.std then
    insert into bases_log (dni, accion, area, articulo, modulo, n_op, operacion, std_antes, std_despues, origen, estudio_id)
    values (v_dni, 'EDITADO', new.area, new.articulo, new.modulo, new.n_op, new.operacion, old.std, new.std, v_org, v_est);
  end if;
  return null;
end $function$;

-- fn_bases_log del parche 86/101, con el origen en la respuesta.
create or replace function public.fn_bases_log(p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text default '')
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare v json;
begin
  perform _vista(p_dni, p_token, array['pasoBaseLog'], coalesce(p_area, ''));
  if p_hasta < p_desde then
    return json_build_object('ok', false, 'error', 'La fecha final no puede ser menor a la inicial');
  end if;
  if (p_hasta - p_desde) > 185 then
    return json_build_object('ok', false, 'error', 'Rango máximo 6 meses');
  end if;

  select coalesce(json_agg(json_build_object(
           'fecha', to_char(l.creado at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'),
           'dni', l.dni, 'nombre', o.nombres_apellidos, 'accion', l.accion,
           'area', l.area, 'articulo', l.articulo, 'modulo', l.modulo,
           'n_op', l.n_op, 'operacion', l.operacion,
           'std_antes', l.std_antes, 'std_despues', l.std_despues,
           'origen', coalesce(l.origen, 'MANUAL'),
           'medido_por', e.dni_analista, 'operarios', s.n_operarios)
           order by l.creado desc, l.id desc), '[]'::json)
    into v
    from bases_log l
    left join operarios o on o.dni = l.dni
    left join tiempos_estudios e on e.id = l.estudio_id
    left join lateral (select count(distinct x.dni_operario) n_operarios
                         from tiempos_estudios x
                        where e.id is not null and x.op_id = e.op_id and x.metodo = e.metodo and x.compite) s on true
   where l.creado >= (p_desde::timestamp at time zone 'America/Lima')
     and l.creado <  ((p_hasta + 1)::timestamp at time zone 'America/Lima')
     and (coalesce(p_area, '') = '' or l.area = p_area);

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- 4. Estándar por operación madre ----------
-- El TN más bajo entre los operarios que compiten, por método. Con un operario
-- el nivel es provisional; con dos, en validación; con tres o más, consolidado.
create or replace view public.tiempos_estandar as
with mejor as (
  select e.op_id, e.metodo, e.dni_operario,
         min(e.tn_min) tn_min,
         (array_agg(e.id order by e.tn_min, e.creado))[1] estudio_id,
         (array_agg(e.te_min order by e.tn_min, e.creado))[1] te_min
    from tiempos_estudios e
   where e.compite and e.tn_min > 0
   group by e.op_id, e.metodo, e.dni_operario
)
select m.op_id, m.metodo,
       min(m.tn_min) tn_min,
       round(avg(m.tn_min), 2) tn_promedio_min,
       (array_agg(m.te_min order by m.tn_min))[1] te_min,
       (array_agg(m.estudio_id order by m.tn_min))[1] estudio_id,
       (array_agg(m.dni_operario order by m.tn_min))[1] dni_operario,
       count(*)::int n_operarios,
       case when count(*) >= 3 then 'consolidado'
            when count(*) = 2 then 'en_validacion'
            else 'provisional' end nivel
  from mejor m
 group by m.op_id, m.metodo;
revoke all on public.tiempos_estandar from anon, authenticated;

-- ---------- 5. Quién puede tomar tiempos ----------
-- Pestaña pasoTmpTomar y EDITAR en el área: medir no cambia la BASE, pero
-- deja rastro a nombre de un operario, así que no vale para solo lectura.
create or replace function public._tmp_analista(p_dni text, p_token uuid, p_area text)
returns operarios language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _vista(p_dni, p_token, array['pasoTmpTomar'], coalesce(p_area, ''));
  perform _vista_area(o, array[p_area], true);
  return o;
end $function$;
revoke all on function public._tmp_analista(text, uuid, text) from public, anon, authenticated;

-- ---------- 6. Sembrar y mantener la base madre ----------
-- Toma las operaciones que ya están en la BASE: una por área, sin repetir.
-- La postura nace en 'sentado' y se corrige desde la pantalla.
create or replace function public._tmp_sembrar(p_area text default null, p_por text default 'PARCHE_104')
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n integer;
begin
  with nuevas as (
    select b.area, _tmp_clave(b.operacion) clave,
           (array_agg(b.operacion order by b.creado desc nulls last))[1] nombre
      from bases b
     where _tmp_clave(b.operacion) <> ''
       and (p_area is null or b.area = p_area)
     group by b.area, _tmp_clave(b.operacion)
  )
  insert into tiempos_operaciones (area, clave, nombre, creado_por)
  select n.area, n.clave, n.nombre, p_por from nuevas n
  on conflict (area, clave) do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public._tmp_sembrar(text, text) from public, anon, authenticated;

select public._tmp_sembrar();

-- Un artículo nuevo trae operaciones nuevas: entran solas a la base madre.
create or replace function public._tmp_bases_trg()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if _tmp_clave(new.operacion) <> '' then
    insert into tiempos_operaciones (area, clave, nombre, creado_por)
    values (new.area, _tmp_clave(new.operacion), new.operacion,
            coalesce(nullif(current_setting('app.dni', true), ''), 'SISTEMA'))
    on conflict (area, clave) do nothing;
  end if;
  return null;
end $function$;
drop trigger if exists tiempos_bases_trg on public.bases;
create trigger tiempos_bases_trg after insert on public.bases
  for each row execute function public._tmp_bases_trg();

-- ---------- 7. Catálogo para el aplicativo de tiempos ----------
-- Todo lo que el celular necesita de un área: artículos, operaciones de la
-- BASE con su STD y su operación madre, y el personal que puede medir.
create or replace function public.fn_tiempos_catalogo(p_dni text, p_token uuid, p_area text)
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare o operarios; v_art json; v_ops json; v_per json; v_mad json;
begin
  o := _tmp_analista(p_dni, p_token, p_area);

  select coalesce(json_agg(json_build_object('articulo', t.articulo, 'prenda', t.prenda,
           'cliente', t.cliente) order by t.articulo), '[]'::json) into v_art
    from (select distinct b.articulo, b.prenda, b.cliente
            from bases b where b.area = p_area and coalesce(b.articulo,'') <> '') t;

  select coalesce(json_agg(json_build_object(
           'articulo', b.articulo, 'n_op', b.n_op, 'modulo', b.modulo,
           'operacion', b.operacion, 'std', b.std, 'op_id', m.id,
           'postura', m.postura, 'nivel', s.nivel, 'te_medido', s.te_min)
           order by b.articulo, b.n_op), '[]'::json) into v_ops
    from bases b
    join tiempos_operaciones m on m.area = b.area and m.clave = _tmp_clave(b.operacion)
    left join tiempos_estandar s on s.op_id = m.id and s.metodo = 'CRONOMETRO'
   where b.area = p_area;

  -- Operaciones del área que no cuelgan de ningún artículo vivo: se puede
  -- medir igual (Ruzaad pidió medir sin que exista la BASE del artículo).
  select coalesce(json_agg(json_build_object('op_id', m.id, 'operacion', m.nombre,
           'postura', m.postura) order by m.nombre), '[]'::json) into v_mad
    from tiempos_operaciones m where m.area = p_area and m.activa;

  select coalesce(json_agg(json_build_object('dni', p.dni, 'nombre', p.nombres_apellidos)
           order by p.nombres_apellidos), '[]'::json) into v_per
    from operarios p
   where p.estado = 'ACTIVO' and p.cargo in ('OPERARIO','ESTAJERO')
     and coalesce(p.area_actual, p.area_origen) = p_area;

  return json_build_object('ok', true, 'analista', o.dni, 'area', p_area,
    'articulos', v_art, 'operaciones', v_ops, 'madre', v_mad, 'personal', v_per);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_tiempos_catalogo(text, uuid, text) from public;
grant execute on function public.fn_tiempos_catalogo(text, uuid, text) to anon, authenticated;

-- ---------- 8. Subida de lo medido ----------
-- El lote llega con el id que generó el dispositivo: reenviarlo no duplica, lo
-- reemplaza. Así la cola de subida sin señal puede reintentar sin miedo.
create or replace function public.fn_tiempos_subir(p_dni text, p_token uuid, p_area text, p_lote jsonb)
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '60s'
as $function$
declare o operarios; e jsonb; v_id uuid; v_op bigint; n integer := 0;
begin
  o := _tmp_analista(p_dni, p_token, p_area);
  if jsonb_typeof(p_lote) <> 'array' then
    return json_build_object('ok', false, 'error', 'El lote debe ser una lista');
  end if;
  if jsonb_array_length(p_lote) > 200 then
    return json_build_object('ok', false, 'error', 'Máximo 200 estudios por envío');
  end if;

  for e in select * from jsonb_array_elements(p_lote) loop
    v_id := (e->>'id')::uuid;
    v_op := (e->>'op_id')::bigint;
    if not exists (select 1 from tiempos_operaciones where id = v_op and area = p_area) then
      raise exception 'OPERACION_FUERA_DE_AREA: la operación no es del área %', p_area;
    end if;

    insert into tiempos_estudios (id, op_id, area, articulo, operacion, dni_analista,
        dni_operario, nombre_operario, fecha, metodo, modo, sesion_id, compite,
        n_ciclos, n_anulados, duracion_seg, prendas, valoracion,
        tn_min, suplemento_pct, te_min, dispersion_cv, observacion, dispositivo)
    values (v_id, v_op, p_area, coalesce(e->>'articulo',''), coalesce(e->>'operacion',''), o.dni,
        nullif(e->>'dni_operario',''), nullif(e->>'nombre_operario',''),
        coalesce((e->>'fecha')::date, current_date),
        upper(coalesce(e->>'metodo','CRONOMETRO')), upper(coalesce(e->>'modo','INDIVIDUAL')),
        nullif(e->>'sesion_id','')::uuid, coalesce((e->>'compite')::boolean, true),
        coalesce((e->>'n_ciclos')::int, 0), coalesce((e->>'n_anulados')::int, 0),
        (e->>'duracion_seg')::numeric, (e->>'prendas')::int, (e->>'valoracion')::numeric,
        (e->>'tn_min')::numeric, coalesce((e->>'suplemento_pct')::numeric, 0.13),
        (e->>'te_min')::numeric, coalesce((e->>'dispersion_cv')::numeric, 0),
        nullif(e->>'observacion',''), nullif(e->>'dispositivo',''))
    on conflict (id) do update set
        op_id = excluded.op_id, articulo = excluded.articulo, operacion = excluded.operacion,
        dni_operario = excluded.dni_operario, nombre_operario = excluded.nombre_operario,
        fecha = excluded.fecha, metodo = excluded.metodo, modo = excluded.modo,
        sesion_id = excluded.sesion_id, compite = excluded.compite,
        n_ciclos = excluded.n_ciclos, n_anulados = excluded.n_anulados,
        duracion_seg = excluded.duracion_seg, prendas = excluded.prendas,
        valoracion = excluded.valoracion, tn_min = excluded.tn_min,
        suplemento_pct = excluded.suplemento_pct, te_min = excluded.te_min,
        dispersion_cv = excluded.dispersion_cv, observacion = excluded.observacion;

    delete from tiempos_ciclos where estudio_id = v_id;
    insert into tiempos_ciclos (estudio_id, n_ciclo, tiempo_seg, valoracion, valido, observacion)
    select v_id, (c->>'n_ciclo')::int, (c->>'tiempo_seg')::numeric,
           coalesce((c->>'valoracion')::numeric, 95), coalesce((c->>'valido')::boolean, true),
           nullif(c->>'observacion','')
      from jsonb_array_elements(coalesce(e->'ciclos', '[]'::jsonb)) c
     on conflict (estudio_id, n_ciclo) do nothing;

    delete from tiempos_inconvenientes where estudio_id = v_id;
    insert into tiempos_inconvenientes (estudio_id, n_ciclo, tipo, duracion_seg, anulo_ciclo, momento_seg, comentario)
    select v_id, coalesce((i->>'n_ciclo')::int, 0), coalesce(i->>'tipo','otro'),
           coalesce((i->>'duracion_seg')::numeric, 0), coalesce((i->>'anulo_ciclo')::boolean, false),
           coalesce((i->>'momento_seg')::numeric, 0), nullif(i->>'comentario','')
      from jsonb_array_elements(coalesce(e->'inconvenientes', '[]'::jsonb)) i;

    n := n + 1;
  end loop;

  return json_build_object('ok', true, 'guardados', n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_tiempos_subir(text, uuid, text, jsonb) from public;
grant execute on function public.fn_tiempos_subir(text, uuid, text, jsonb) to anon, authenticated;

-- Lo que el analista ya subió, para que el celular no vuelva a mandarlo.
create or replace function public.fn_tiempos_mios(p_dni text, p_token uuid, p_area text, p_desde date default null)
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare o operarios; v json;
begin
  o := _tmp_analista(p_dni, p_token, p_area);
  select coalesce(json_agg(json_build_object('id', e.id, 'fecha', e.fecha,
           'operacion', e.operacion, 'articulo', e.articulo,
           'nombre_operario', e.nombre_operario, 'metodo', e.metodo,
           'te_min', e.te_min, 'tn_min', e.tn_min) order by e.creado desc), '[]'::json)
    into v from tiempos_estudios e
   where e.area = p_area and e.dni_analista = o.dni
     and e.fecha >= coalesce(p_desde, current_date - 30);
  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_tiempos_mios(text, uuid, text, date) from public;
grant execute on function public.fn_tiempos_mios(text, uuid, text, date) to anon, authenticated;

-- ---------- 9. Tiempos medidos vs BASE (Ingeniería) ----------
create or replace function public.fn_tiempos_medidos(p_dni text, p_token uuid, p_area text, p_articulo text default '')
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare v json;
begin
  perform _vista(p_dni, p_token, array['pasoTmpMed'], coalesce(p_area, ''));
  if coalesce(p_area, '') = '' then
    return json_build_object('ok', false, 'error', 'Elige un área');
  end if;

  select coalesce(json_agg(json_build_object(
           'op_id', m.id, 'n_op', b.n_op, 'modulo', b.modulo, 'operacion', b.operacion,
           'articulo', b.articulo, 'std', b.std, 'postura', m.postura,
           'te_min', s.te_min, 'tn_min', s.tn_min, 'nivel', s.nivel,
           'n_operarios', s.n_operarios, 'ultimo', u.ultimo, 'min_30d', coalesce(p.min_30d, 0))
           order by b.n_op), '[]'::json) into v
    from bases b
    join tiempos_operaciones m on m.area = b.area and m.clave = _tmp_clave(b.operacion)
    left join tiempos_estandar s on s.op_id = m.id and s.metodo = 'CRONOMETRO'
    left join lateral (select max(x.fecha) ultimo from tiempos_estudios x where x.op_id = m.id) u on true
    left join lateral (select sum(r.minutos) min_30d from reclamos r
                        where r.op_id = b.op_id and r.fecha >= current_date - 30) p on true
   where b.area = p_area
     and (coalesce(p_articulo, '') = '' or b.articulo = p_articulo);

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_tiempos_medidos(text, uuid, text, text) from public;
grant execute on function public.fn_tiempos_medidos(text, uuid, text, text) to anon, authenticated;

-- Cada medición de una operación madre, con los cambios de STD que tuvo.
create or replace function public.fn_tiempos_detalle(p_dni text, p_token uuid, p_op_id bigint)
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare m tiempos_operaciones; v_est json; v_log json; v_std json;
begin
  select * into m from tiempos_operaciones where id = p_op_id;
  if not found then return json_build_object('ok', false, 'error', 'Operación no encontrada'); end if;
  perform _vista(p_dni, p_token, array['pasoTmpMed'], m.area);

  select coalesce(json_agg(json_build_object(
           'id', e.id, 'fecha', e.fecha, 'analista', e.dni_analista,
           'operario', coalesce(e.nombre_operario, e.dni_operario), 'articulo', e.articulo,
           'metodo', e.metodo, 'modo', e.modo, 'n_ciclos', e.n_ciclos,
           'tn_min', e.tn_min, 'te_min', e.te_min, 'dispersion_cv', e.dispersion_cv,
           'compite', e.compite) order by e.fecha desc, e.creado desc), '[]'::json)
    into v_est from tiempos_estudios e where e.op_id = p_op_id;

  select coalesce(json_agg(json_build_object('op_id', s.op_id, 'metodo', s.metodo,
           'tn_min', s.tn_min, 'te_min', s.te_min, 'nivel', s.nivel,
           'n_operarios', s.n_operarios, 'operario', s.dni_operario)), '[]'::json)
    into v_std from tiempos_estandar s where s.op_id = p_op_id;

  select coalesce(json_agg(json_build_object(
           'fecha', to_char(l.creado at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'),
           'dni', l.dni, 'articulo', l.articulo, 'origen', coalesce(l.origen,'MANUAL'),
           'std_antes', l.std_antes, 'std_despues', l.std_despues)
           order by l.creado desc), '[]'::json)
    into v_log from bases_log l
   where l.area = m.area and _tmp_clave(l.operacion) = m.clave
     and l.creado >= now() - interval '1 year';

  return json_build_object('ok', true, 'operacion', m.nombre, 'area', m.area,
    'postura', m.postura, 'estandares', v_std, 'estudios', v_est, 'cambios', v_log);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_tiempos_detalle(text, uuid, bigint) from public;
grant execute on function public.fn_tiempos_detalle(text, uuid, bigint) to anon, authenticated;

-- ---------- 10. Qué falta medir ----------
-- Lo que más se produjo en el periodo y no tiene un estudio que lo sustente.
create or replace function public.fn_tiempos_falta(p_dni text, p_token uuid, p_area text default '', p_dias integer default 30)
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '45s'
as $function$
declare v json; d integer := least(greatest(coalesce(p_dias, 30), 1), 180);
begin
  perform _vista(p_dni, p_token, array['pasoTmpFalta'], coalesce(p_area, ''));

  with prod as (
    select r.area, r.op_id, sum(r.minutos) min_prod, sum(r.cant) und
      from reclamos r
     where r.fecha >= current_date - d and r.op_id is not null
       and (coalesce(p_area, '') = '' or r.area = p_area)
     group by r.area, r.op_id
  )
  select coalesce(json_agg(json_build_object(
           'area', b.area, 'articulo', b.articulo, 'operacion', b.operacion,
           'n_op', b.n_op, 'std', b.std, 'op_id', m.id,
           'nivel', s.nivel, 'n_operarios', coalesce(s.n_operarios, 0),
           'ultimo', u.ultimo, 'min_prod', round(pr.min_prod), 'und', round(pr.und))
           order by pr.min_prod desc), '[]'::json) into v
    from prod pr
    join bases b on b.op_id = pr.op_id
    join tiempos_operaciones m on m.area = b.area and m.clave = _tmp_clave(b.operacion)
    left join tiempos_estandar s on s.op_id = m.id and s.metodo = 'CRONOMETRO'
    left join lateral (select max(x.fecha) ultimo from tiempos_estudios x where x.op_id = m.id) u on true
   where s.op_id is null or s.nivel <> 'consolidado' or u.ultimo < current_date - 180;

  return json_build_object('ok', true, 'dias', d, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_tiempos_falta(text, uuid, text, integer) from public;
grant execute on function public.fn_tiempos_falta(text, uuid, text, integer) to anon, authenticated;

-- ---------- 11. Aplicar lo medido a la BASE ----------
-- Nunca automático: lo pulsa alguien con EDITAR en el área. Cada operación
-- cambia el STD de las filas de la BASE que le corresponden, y el cambio queda
-- en bases_log con origen ESTUDIO y el estudio que lo sustenta.
create or replace function public.fn_tiempos_aplicar(p_dni text, p_token uuid, p_area text,
                                                     p_ops bigint[], p_articulo text default '')
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '45s'
as $function$
declare o operarios; m tiempos_operaciones; s record; i bigint; n integer := 0; f integer := 0;
begin
  o := _vista(p_dni, p_token, array['pasoTmpMed'], p_area);
  perform _vista_area(o, array[p_area], true);
  if coalesce(array_length(p_ops, 1), 0) = 0 then
    return json_build_object('ok', false, 'error', 'No elegiste ninguna operación');
  end if;
  if array_length(p_ops, 1) > 200 then
    return json_build_object('ok', false, 'error', 'Máximo 200 operaciones por vez');
  end if;

  perform set_config('app.origen', 'ESTUDIO', true);
  foreach i in array p_ops loop
    select * into m from tiempos_operaciones where id = i and area = p_area;
    if not found then raise exception 'OPERACION_FUERA_DE_AREA: % no es del área %', i, p_area; end if;

    select * into s from tiempos_estandar where op_id = i and metodo = 'CRONOMETRO';
    if not found or s.te_min is null or s.te_min <= 0 then
      raise exception 'SIN_ESTUDIO: % no tiene un estudio por cronómetro', m.nombre;
    end if;

    perform set_config('app.estudio', s.estudio_id::text, true);
    update bases b set std = round(s.te_min, 2)
     where b.area = p_area and _tmp_clave(b.operacion) = m.clave
       and (coalesce(p_articulo, '') = '' or b.articulo = p_articulo)
       and b.std is distinct from round(s.te_min, 2);
    get diagnostics f = row_count;
    n := n + f;
  end loop;
  perform set_config('app.estudio', '', true);
  perform set_config('app.origen', 'MANUAL', true);

  return json_build_object('ok', true, 'filas', n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_tiempos_aplicar(text, uuid, text, bigint[], text) from public;
grant execute on function public.fn_tiempos_aplicar(text, uuid, text, bigint[], text) to anon, authenticated;

-- La postura manda el suplemento (18 % de pie, 13 % sentado) y vive en la
-- operación, no en el estudio.
create or replace function public.fn_tiempos_postura(p_dni text, p_token uuid, p_op_id bigint, p_postura text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; m tiempos_operaciones;
begin
  select * into m from tiempos_operaciones where id = p_op_id;
  if not found then return json_build_object('ok', false, 'error', 'Operación no encontrada'); end if;
  o := _vista(p_dni, p_token, array['pasoTmpMed'], m.area);
  perform _vista_area(o, array[m.area], true);
  if p_postura not in ('pie','sentado') then
    return json_build_object('ok', false, 'error', 'La postura es pie o sentado');
  end if;
  update tiempos_operaciones set postura = p_postura where id = p_op_id;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_tiempos_postura(text, uuid, bigint, text) from public;
grant execute on function public.fn_tiempos_postura(text, uuid, bigint, text) to anon, authenticated;

-- ---------- 12. Permisos de arranque ----------
-- El administrador ve todo por es_admin. A los analistas de INGENIERIA se les
-- dan las dos pantallas de lectura; "Tomar tiempos" lo reparte el maestro.
insert into permisos_pestana (dni, pestana, asignado_por)
select o.dni, t, 'PARCHE_104'
  from operarios o, unnest(array['pasoTmpMed','pasoTmpFalta']) t
 where o.cargo = 'INGENIERIA' and not coalesce(o.es_admin, false) and o.estado = 'ACTIVO'
on conflict (dni, pestana) do nothing;

commit;

-- Verificación (opcional):
-- select area, count(*) from tiempos_operaciones group by area order by 1;
-- select * from tiempos_estandar limit 5;
