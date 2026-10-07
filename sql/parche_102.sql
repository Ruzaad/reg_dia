-- PARCHE 102 — Liberar y mover tickets: vista previa, deshacer y registro de quién lo hizo
--
-- Hasta hoy liberar (fn_liberar_ids / _ticket / _lote), mover de día
-- (fn_reclamos_cambiar_fecha) y partir (fn_reclamo_partir) no dejaban rastro de
-- quién ni cuándo, la fecha anterior se perdía y no había forma de volver atrás.
--
--   · tickets_cambios      una fila por acción: quién, cuándo, motivo, áreas, resumen.
--   · tickets_cambios_det  cada fila de reclamos/residuales que tocó, antes y después.
--     La llena un trigger mientras la acción está abierta (app.cambio), así que
--     también queda lo que mueve _deshacer_troceo (paquete, residuales, reclamos de otros).
--   · fn_tickets_previa       qué se va a liberar o mover, sin tocar nada.
--   · fn_tickets_deshacer     vuelve todo a como estaba, si nadie lo tocó después.
--   · fn_tickets_cambios_listar / fn_tickets_cambio_detalle  el historial.
--
-- Las RPC de escritura conservan su firma (los despliegues viejos siguen
-- funcionando) y ahora: exigen motivo para liberar, solo mueven tickets ACTIVOS
-- que cambian de fecha, y devuelven el id del cambio para deshacerlo.
-- Los permisos por área del parche 95 siguen mandando (trigger perm_area_trg).
--
-- Re-ejecutable. Vuelta atrás: sql/parche_102_rollback.sql.
begin;

-- ---------- 1. Tablas ----------
create table if not exists public.tickets_cambios (
  id           bigserial primary key,
  accion       text not null check (accion in ('LIBERAR','MOVER','PARTIR','DESHACER')),
  dni          text not null,
  creado       timestamptz not null default now(),
  motivo       text,
  areas        text[],
  n            int not null default 0,
  resumen      jsonb,
  deshace_a    bigint references public.tickets_cambios(id),
  deshecho_en  timestamptz,
  deshecho_por text
);
create index if not exists tickets_cambios_creado_idx on public.tickets_cambios (creado desc);

create table if not exists public.tickets_cambios_det (
  id        bigserial primary key,
  cambio_id bigint not null references public.tickets_cambios(id) on delete cascade,
  tabla     text not null,
  op        char(1) not null,
  fila      text not null,
  antes     jsonb,
  despues   jsonb
);
create index if not exists tickets_cambios_det_cambio_idx on public.tickets_cambios_det (cambio_id, fila);

alter table public.tickets_cambios     enable row level security;
alter table public.tickets_cambios_det enable row level security;
revoke all on public.tickets_cambios, public.tickets_cambios_det from anon, authenticated;

-- ---------- 2. Registro automático mientras hay un cambio abierto ----------
create or replace function public._tickets_cambio_trg()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare c bigint := nullif(current_setting('app.cambio', true), '')::bigint;
        a jsonb; d jsonb; r jsonb;
begin
  if c is null then return null; end if;
  if tg_op <> 'INSERT' then a := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then d := to_jsonb(new); end if;
  if a = d then return null; end if;
  r := coalesce(d, a);
  insert into tickets_cambios_det (cambio_id, tabla, op, fila, antes, despues)
  values (c, tg_table_name, left(tg_op, 1),
          case tg_table_name when 'reclamos' then r->>'id' else (r->>'area') || '|' || (r->>'codigo') end,
          a, d);
  return null;
end $function$;
revoke execute on function public._tickets_cambio_trg() from public, anon, authenticated;

drop trigger if exists tickets_cambio_trg on public.reclamos;
create trigger tickets_cambio_trg after insert or update or delete on public.reclamos
  for each row when (coalesce(current_setting('app.cambio', true), '') <> '')
  execute function public._tickets_cambio_trg();
drop trigger if exists tickets_cambio_trg on public.residuales;
create trigger tickets_cambio_trg after insert or update or delete on public.residuales
  for each row when (coalesce(current_setting('app.cambio', true), '') <> '')
  execute function public._tickets_cambio_trg();

create or replace function public._cambio_abrir(p_accion text, p_motivo text, p_deshace bigint default null)
 returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare v bigint;
begin
  insert into tickets_cambios (accion, dni, motivo, deshace_a)
  values (p_accion, coalesce(nullif(current_setting('app.dni', true), ''), '?'), p_motivo, p_deshace)
  returning id into v;
  perform set_config('app.cambio', v::text, true);
  return v;
end $function$;

-- Cierra el cambio y guarda su resumen. Si no tocó nada, el cambio no queda.
create or replace function public._cambio_cerrar(p_id bigint)
 returns bigint language plpgsql security definer set search_path to 'public'
as $function$
declare v_n int; v_areas text[]; v_res jsonb;
begin
  perform set_config('app.cambio', '', true);
  with f as (   -- por fila: primer "antes" y último "después"
    select distinct on (fila) fila,
           first_value(antes) over w a, last_value(despues) over w d
      from tickets_cambios_det where cambio_id = p_id and tabla = 'reclamos'
    window w as (partition by fila order by id rows between unbounded preceding and unbounded following)
  ), x as (
    select coalesce(d, a) r, a, d from f
  )
  select count(*), array_agg(distinct x.r->>'area'),
         jsonb_build_object(
           'cant',     round(sum((coalesce(x.a, x.d)->>'cant')::numeric), 0),
           'min',      round(sum(coalesce((coalesce(x.a, x.d)->>'minutos')::numeric, 0)), 1),
           'personas', (select jsonb_agg(distinct o.nombres_apellidos) from x x2 join operarios o on o.dni = x2.r->>'dni'),
           'ofs',      jsonb_agg(distinct x.r->>'o_f') filter (where x.r->>'o_f' is not null),
           'ops',      jsonb_agg(distinct x.r->>'op') filter (where x.r->>'op' is not null),
           'de',       jsonb_agg(distinct x.a->>'fecha') filter (where x.a is not null),
           'a',        jsonb_agg(distinct x.d->>'fecha') filter (where x.d is not null
                         and (x.a is null or x.d->>'fecha' is distinct from x.a->>'fecha')),
           'residuales', (select count(distinct fila) from tickets_cambios_det
                           where cambio_id = p_id and tabla = 'residuales'))
    into v_n, v_areas, v_res
    from x;
  if coalesce(v_n, 0) = 0 then
    delete from tickets_cambios where id = p_id;
    return null;
  end if;
  update tickets_cambios set n = v_n, areas = v_areas, resumen = v_res where id = p_id;
  return p_id;
end $function$;
revoke execute on function public._cambio_abrir(text, text, bigint) from public, anon, authenticated;
revoke execute on function public._cambio_cerrar(bigint) from public, anon, authenticated;

-- ---------- 3. Las RPC de escritura registran el cambio ----------
create or replace function public.fn_liberar_ids(p_dni text, p_token text, p_ids bigint[], p_motivo text)
 returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare r record; v_tro json; v_n int := 0; v_k int; v_av json[] := '{}'; v_mot text; v_c bigint;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if p_ids is null or array_length(p_ids,1) is null then
    return json_build_object('ok', false, 'error', 'No hay tickets seleccionados'); end if;
  v_mot := nullif(trim(coalesce(p_motivo, '')), '');
  if v_mot is null then return json_build_object('ok', false, 'error', 'Indica el motivo para liberar'); end if;
  v_c := _cambio_abrir('LIBERAR', v_mot);

  for r in select id, area, codigo from reclamos
            where id = any(p_ids) and estado = 'ACTIVO' order by id loop
    if r.codigo is not null then
      v_tro := _deshacer_troceo(r.area, r.codigo, v_mot);
      if json_array_length(v_tro->'anulados') > 0 then
        v_av := v_av || json_build_object('codigo', r.codigo,
          'anulados', v_tro->'anulados', 'liberados', v_tro->'liberados');
      end if;
    end if;
    update reclamos set estado = 'LIBERADO', motivo_liberacion = v_mot
     where id = r.id and estado = 'ACTIVO';
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;

  v_c := _cambio_cerrar(v_c);
  if v_n = 0 then
    return json_build_object('ok', false, 'error', 'No hay reclamos activos en la selección'); end if;
  return json_build_object('ok', true, 'liberados', v_n, 'cambio', v_c,
    'troceos_deshechos', to_json(v_av));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_liberar_ticket(p_dni text, p_token text, p_codigo text, p_motivo text, p_area text default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_area text; v_tro json; v_mot text; v_c bigint;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  v_mot := nullif(trim(coalesce(p_motivo, '')), '');
  if v_mot is null then return json_build_object('ok', false, 'error', 'Indica el motivo para liberar'); end if;
  select area into v_area from reclamos
   where codigo = p_codigo and estado = 'ACTIVO' and (p_area is null or area = p_area)
   limit 1;
  if v_area is null then
    return json_build_object('ok', false, 'error', 'No hay un reclamo activo con ese código'); end if;
  v_c := _cambio_abrir('LIBERAR', v_mot);
  v_tro := _deshacer_troceo(v_area, p_codigo, v_mot);
  update reclamos set estado = 'LIBERADO', motivo_liberacion = v_mot
   where codigo = p_codigo and estado = 'ACTIVO' and area = v_area;
  v_c := _cambio_cerrar(v_c);
  return json_build_object('ok', true, 'codigo', p_codigo, 'area', v_area, 'cambio', v_c,
    'cant_restaurada', v_tro->'restaurada',
    'residuales_anulados', v_tro->'anulados',
    'reclamos_liberados', v_tro->'liberados');
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_liberar_lote(p_dni text, p_token text, p_codigos text[], p_motivo text, p_area text default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare c text; v_area text; v_tro json; v_n int := 0; v_av json[] := '{}'; v_mot text; v_c bigint;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if p_codigos is null or array_length(p_codigos,1) is null then
    return json_build_object('ok', false, 'error', 'No hay tickets seleccionados'); end if;
  v_mot := nullif(trim(coalesce(p_motivo, '')), '');
  if v_mot is null then return json_build_object('ok', false, 'error', 'Indica el motivo para liberar'); end if;
  v_c := _cambio_abrir('LIBERAR', v_mot);
  foreach c in array p_codigos loop
    v_area := null;
    select area into v_area from reclamos
     where codigo = c and estado = 'ACTIVO' and (p_area is null or area = p_area)
     limit 1;
    if v_area is not null then
      v_tro := _deshacer_troceo(v_area, c, v_mot);
      update reclamos set estado = 'LIBERADO', motivo_liberacion = v_mot
       where codigo = c and estado = 'ACTIVO' and area = v_area;
      v_n := v_n + 1;
      if json_array_length(v_tro->'anulados') > 0 then
        v_av := v_av || json_build_object('codigo', c,
          'anulados', v_tro->'anulados', 'liberados', v_tro->'liberados');
      end if;
    end if;
  end loop;
  v_c := _cambio_cerrar(v_c);
  return json_build_object('ok', true, 'liberados', v_n, 'cambio', v_c,
    'troceos_deshechos', to_json(v_av));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Solo mueve tickets ACTIVOS que de verdad cambian de fecha.
create or replace function public.fn_reclamos_cambiar_fecha(p_dni text, p_token text, p_ids bigint[], p_fecha date, p_motivo text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_motivo text; v_n int := 0; v_c bigint;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if p_ids is null or array_length(p_ids,1) is null then
    return json_build_object('ok', false, 'error', 'No hay tickets seleccionados'); end if;
  if p_fecha is null then return json_build_object('ok', false, 'error', 'Elige la nueva fecha'); end if;
  v_motivo := upper(trim(coalesce(p_motivo,'')));
  if v_motivo = '' then return json_build_object('ok', false, 'error', 'Indica el motivo'); end if;

  insert into motivos_cambio_fecha(texto) values (v_motivo) on conflict (texto) do nothing;
  v_c := _cambio_abrir('MOVER', v_motivo);
  update reclamos set fecha = p_fecha, motivo_fecha = v_motivo
   where id = any(p_ids) and estado = 'ACTIVO' and fecha is distinct from p_fecha;
  get diagnostics v_n = row_count;
  v_c := _cambio_cerrar(v_c);
  if v_n = 0 then
    return json_build_object('ok', false, 'error', 'Ningún ticket activo cambia de fecha'); end if;
  return json_build_object('ok', true, 'cambiados', v_n, 'motivo', v_motivo, 'cambio', v_c);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_reclamo_partir(p_dni text, p_token text, p_id bigint, p_cant numeric, p_fecha date, p_motivo text, p_causa text default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare r reclamos; v_mot text; v_new bigint; v_fecha date;
        v_causa text; v_delta numeric := 0; v_base numeric; v_std numeric; v_c bigint;
begin
  perform fn_validar_ingenieria(p_dni, p_token);

  select * into r from reclamos where id = p_id;
  if not found then return json_build_object('ok',false,'error','No existe ese registro'); end if;
  if r.estado <> 'ACTIVO' then
    return json_build_object('ok',false,'error','El registro no está activo'); end if;
  if r.codigo is not null then
    return json_build_object('ok',false,'error',
      'Ese ticket tiene código: es un paquete, no una cantidad. Muévelo entero o libéralo.'); end if;
  if coalesce(p_cant,0) <= 0 then
    return json_build_object('ok',false,'error','Indica una cantidad mayor que cero'); end if;
  if p_cant >= r.cant then
    return json_build_object('ok',false,'error',
      'Para mover todo ('||round(r.cant,0)||') usa Cambiar fecha, no Partir'); end if;

  v_fecha := coalesce(p_fecha, r.fecha);
  v_causa := nullif(upper(trim(coalesce(p_causa,''))), '');
  if v_fecha = r.fecha and v_causa is not distinct from r.causa then
    return json_build_object('ok',false,'error',
      'No cambia nada: elige otra fecha, otra causa, o las dos'); end if;

  if v_causa is not null then
    select c.delta into v_delta from causas_std c where c.texto = v_causa and c.activa;
    if not found then
      return json_build_object('ok',false,'error','Esa causa no existe o está desactivada'); end if;
  end if;

  v_base := coalesce(r.std_base, r.std);
  v_std  := v_base + coalesce(v_delta,0);
  if v_std <= 0 then
    return json_build_object('ok',false,'error','La causa deja el STD en cero o negativo'); end if;

  v_mot := nullif(upper(trim(coalesce(p_motivo,''))), '');
  if v_mot is null then return json_build_object('ok',false,'error','Indica el motivo'); end if;
  insert into motivos_cambio_fecha(texto) values (v_mot) on conflict (texto) do nothing;

  v_c := _cambio_abrir('PARTIR', v_mot);
  update reclamos set cant = cant - p_cant where id = r.id;
  insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant, numeracion,
                        articulo, color, talla, corte, nop, op_id, causa, std_base,
                        estado, fecha, motivo_fecha, op_adicional_id)
  values (null, r.dni, r.area, r.o_f, r.modulo, r.op, v_std, p_cant, r.numeracion,
          r.articulo, r.color, r.talla, r.corte, r.nop, r.op_id, v_causa,
          case when v_causa is null then null else v_base end,
          'ACTIVO', v_fecha, v_mot, r.op_adicional_id)
  returning id into v_new;
  v_c := _cambio_cerrar(v_c);

  return json_build_object('ok', true, 'id_original', r.id, 'id_nuevo', v_new, 'cambio', v_c,
    'queda', round(r.cant - p_cant, 0), 'movido', round(p_cant, 0),
    'fecha', v_fecha, 'causa', v_causa, 'std', round(v_std,2));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- 4. Vista previa (no toca nada) ----------
-- p_accion: LIBERAR | MOVER. Devuelve lo que de verdad va a cambiar, lo que se
-- queda fuera (no activos, sin permiso, misma fecha) y avisos.
create or replace function public.fn_tickets_previa(p_dni text, p_token text, p_accion text, p_ids bigint[], p_fecha date default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare p text; v json;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  p := coalesce(current_setting('app.perm', true), '*');
  if upper(coalesce(p_accion,'')) not in ('LIBERAR','MOVER') then
    return json_build_object('ok', false, 'error', 'Acción desconocida'); end if;
  if upper(p_accion) = 'MOVER' and p_fecha is null then
    return json_build_object('ok', false, 'error', 'Elige la nueva fecha'); end if;

  with s as (
    select r.*, o.nombres_apellidos nombre,
           (p = '*' or position('|' || r.area || '|' in p) > 0) puede
      from reclamos r left join operarios o on o.dni = r.dni
     where r.id = any(coalesce(p_ids, '{}'))
  ), va as (
    select * from s where estado = 'ACTIVO' and puede
       and (upper(p_accion) <> 'MOVER' or fecha is distinct from p_fecha)
  ), tro as (   -- residuales de esos paquetes que ya tomó otra persona
    select x.codigo, o.nombres_apellidos nombre, round(x.cant,0) cant
      from va join residuales rs on rs.area = va.area and rs.codigo_origen = va.codigo and rs.estado = 'ACTIVO'
      join reclamos x on x.area = rs.area and x.codigo = rs.codigo and x.estado = 'ACTIVO'
      join operarios o on o.dni = x.dni
     where va.codigo is not null
  )
  select json_build_object('ok', true,
    'accion', upper(p_accion), 'fecha_nueva', p_fecha,
    'n',     (select count(*) from va),
    'cant',  (select round(coalesce(sum(cant),0),0) from va),
    'min',   (select round(coalesce(sum(minutos),0),1) from va),
    'personas', (select count(distinct dni) from va),
    'grupos', coalesce((select json_agg(g order by g.nombre, g.fecha, g.of, g.op) from (
        select nombre, dni, area, o_f "of", op, to_char(fecha,'YYYY-MM-DD') fecha,
               count(*) n, round(sum(cant),0) cant, round(sum(minutos),1) min,
               string_agg(numeracion, ', ' order by numeracion) filter (where numeracion is not null) nums
          from va group by nombre, dni, area, o_f, op, fecha) g), '[]'),
    'no_activos',  (select count(*) from s where estado <> 'ACTIVO'),
    'misma_fecha', (select count(*) from s where estado = 'ACTIVO' and puede
                       and upper(p_accion) = 'MOVER' and fecha = p_fecha),
    'sin_permiso', coalesce((select json_agg(distinct area) from s where estado = 'ACTIVO' and not puede), '[]'),
    'troceo', coalesce((select json_agg(t) from tro t), '[]'),
    'paquetes_troceados', (select count(*) from va where cant_asignada is not null),
    'avisos', coalesce((select json_agg(a) from (
        select 'La nueva fecha es futura' a where upper(p_accion) = 'MOVER' and p_fecha > _hoy()
        union all
        select 'Hay tickets que se mueven más de 7 días'
         where upper(p_accion) = 'MOVER' and exists (select 1 from va where abs(fecha - p_fecha) > 7)
        union all
        select 'Son tickets de ' || (select count(distinct dni) from va) || ' personas distintas'
         where (select count(distinct dni) from va) > 1
        union all
        select 'Incluye tickets de hace más de 7 días'
         where exists (select 1 from va where fecha < _hoy() - 7)) z), '[]')
  ) into v;
  return v;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- 5. Deshacer ----------
-- Lo puede deshacer quien lo hizo dentro de 24 horas, o el administrador.
-- Solo si ninguna fila cambió después; si no, dice cuál y no toca nada.
create or replace function public._tc_claves(p_tabla text, j jsonb)
 returns jsonb language sql immutable
as $function$
  select case when j is null then null
    when p_tabla = 'reclamos' then jsonb_build_object('estado', j->'estado', 'fecha', j->'fecha',
         'cant', j->'cant', 'cant_asignada', j->'cant_asignada',
         'motivo_fecha', j->'motivo_fecha', 'motivo_liberacion', j->'motivo_liberacion')
    else jsonb_build_object('estado', j->'estado', 'anulado_en', j->'anulado_en') end
$function$;

create or replace function public.fn_tickets_deshacer(p_dni text, p_token text, p_id bigint)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; c tickets_cambios; d record; cur jsonb; v_a text; v_cod text;
        v_otro text; v_c bigint; v_n int := 0;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  select * into o from operarios where dni = p_dni;
  select * into c from tickets_cambios where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'No existe ese cambio'); end if;
  if c.accion = 'DESHACER' then
    return json_build_object('ok', false, 'error', 'Esto ya es un deshacer: vuelve a hacer el cambio'); end if;
  if c.deshecho_en is not null then
    return json_build_object('ok', false, 'error', 'Ya se deshizo el '
      || to_char(c.deshecho_en at time zone 'America/Lima', 'DD/MM HH24:MI') || ' (' || c.deshecho_por || ')'); end if;
  if not coalesce(o.es_admin, false) then
    if c.dni <> o.dni then
      return json_build_object('ok', false, 'error', 'Solo lo puede deshacer quien lo hizo (' || c.dni || ') o el administrador'); end if;
    if c.creado < now() - interval '24 hours' then
      return json_build_object('ok', false, 'error', 'Pasaron más de 24 horas: pídeselo al administrador'); end if;
  end if;

  -- 1) Nada cambió después: cada fila sigue como la dejó el cambio.
  for d in select distinct on (tabla, fila) tabla, fila, despues, antes
             from tickets_cambios_det where cambio_id = p_id order by tabla, fila, id desc loop
    if d.tabla = 'reclamos' then
      select to_jsonb(r) into cur from reclamos r where r.id = d.fila::bigint;
    else
      v_a := split_part(d.fila, '|', 1); v_cod := substr(d.fila, length(v_a) + 2);
      select to_jsonb(s) into cur from residuales s where s.area = v_a and s.codigo = v_cod;
    end if;
    if _tc_claves(d.tabla, cur) is distinct from _tc_claves(d.tabla, d.despues) then
      return json_build_object('ok', false, 'error',
        'No se puede deshacer: ' || coalesce('el ticket ' || coalesce(d.despues->>'numeracion', d.despues->>'codigo', d.antes->>'numeracion'),
        'un ticket') || ' de OF ' || coalesce(d.despues->>'o_f', d.antes->>'o_f', '—') || ' cambió después');
    end if;
  end loop;

  -- 2) Volver a ACTIVO no puede chocar con alguien que ya lo tomó de nuevo.
  select coalesce(op.nombres_apellidos, x.dni) || ' (' || coalesce(x.numeracion, x.codigo) || ')' into v_otro
    from (select distinct on (fila) fila, antes from tickets_cambios_det
           where cambio_id = p_id and tabla = 'reclamos' order by fila, id) f
    join reclamos x on x.area = f.antes->>'area' and x.codigo = f.antes->>'codigo'
                   and x.estado = 'ACTIVO' and x.id <> (f.antes->>'id')::bigint
    left join operarios op on op.dni = x.dni
   where f.antes->>'estado' = 'ACTIVO' and f.antes->>'codigo' is not null
   limit 1;
  if v_otro is not null then
    return json_build_object('ok', false, 'error', 'No se puede deshacer: ese paquete ya lo tomó ' || v_otro); end if;

  -- 3) Al revés, en orden inverso.
  v_c := _cambio_abrir('DESHACER', 'Deshace el cambio #' || p_id, p_id);
  for d in select * from tickets_cambios_det where cambio_id = p_id order by id desc loop
    if d.tabla = 'reclamos' then
      if d.op = 'I' then
        delete from reclamos where id = d.fila::bigint;
      elsif d.op = 'U' then
        update reclamos set estado = d.antes->>'estado', fecha = (d.antes->>'fecha')::date,
               cant = (d.antes->>'cant')::numeric, cant_asignada = (d.antes->>'cant_asignada')::numeric,
               motivo_fecha = d.antes->>'motivo_fecha', motivo_liberacion = d.antes->>'motivo_liberacion'
         where id = d.fila::bigint;
      end if;
    else
      v_a := split_part(d.fila, '|', 1); v_cod := substr(d.fila, length(v_a) + 2);
      if d.op = 'U' then
        update residuales set estado = d.antes->>'estado', anulado_en = (d.antes->>'anulado_en')::timestamptz
         where area = v_a and codigo = v_cod;
      elsif d.op = 'I' then
        delete from residuales where area = v_a and codigo = v_cod;
      end if;
    end if;
    v_n := v_n + 1;
  end loop;
  v_c := _cambio_cerrar(v_c);
  update tickets_cambios set deshecho_en = now(), deshecho_por = o.dni where id = p_id;
  return json_build_object('ok', true, 'cambio', v_c, 'deshecho', p_id, 'n', c.n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- 6. Historial ----------
-- Cada quien ve los cambios de las áreas que puede leer; el administrador, todos.
create or replace function public.fn_tickets_cambios_listar(p_dni text, p_token text, p_desde date, p_hasta date, p_area text default '')
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios; v_todas boolean; v_areas text[];
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  select * into o from operarios where dni = p_dni;
  v_todas := coalesce(o.es_admin, false)
          or not exists (select 1 from permisos_area where dni = o.dni)
          or exists (select 1 from permisos_area where dni = o.dni and area = '*');
  select array_agg(area) into v_areas from permisos_area where dni = o.dni;
  return coalesce((select json_agg(json_build_object(
      'id', c.id, 'accion', c.accion, 'dni', c.dni, 'nombre', coalesce(q.nombres_apellidos, c.dni),
      'creado', to_char(c.creado at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'),
      'motivo', c.motivo, 'areas', c.areas, 'n', c.n, 'resumen', c.resumen, 'deshace_a', c.deshace_a,
      'deshecho_en', to_char(c.deshecho_en at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'),
      'deshecho_por', coalesce(qd.nombres_apellidos, c.deshecho_por),
      'puede_deshacer', c.accion <> 'DESHACER' and c.deshecho_en is null
          and (coalesce(o.es_admin, false) or (c.dni = o.dni and c.creado > now() - interval '24 hours')))
      order by c.creado desc)
    from tickets_cambios c
    left join operarios q  on q.dni  = c.dni
    left join operarios qd on qd.dni = c.deshecho_por
   where (c.creado at time zone 'America/Lima')::date between coalesce(p_desde, _hoy()) and coalesce(p_hasta, _hoy())
     and (nullif(p_area, '') is null or p_area = any(c.areas))
     and (v_todas or c.areas && v_areas)), '[]'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Ticket por ticket: cómo estaba y cómo quedó.
create or replace function public.fn_tickets_cambio_detalle(p_dni text, p_token text, p_id bigint)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  return coalesce((select json_agg(json_build_object(
      'nombre', coalesce(o.nombres_apellidos, r->>'dni'), 'area', r->>'area', 'of', r->>'o_f',
      'op', r->>'op', 'num', r->>'numeracion', 'nuevo', a is null,
      'cant_antes', a->>'cant', 'cant_despues', d->>'cant',
      'fecha_antes', a->>'fecha', 'fecha_despues', d->>'fecha',
      'estado_antes', a->>'estado', 'estado_despues', d->>'estado')
      order by o.nombres_apellidos, r->>'o_f', r->>'op', r->>'numeracion')
    from (select distinct on (fila) fila,
                 first_value(antes) over w a, last_value(despues) over w d,
                 coalesce(last_value(despues) over w, first_value(antes) over w) r
            from tickets_cambios_det where cambio_id = p_id and tabla = 'reclamos'
          window w as (partition by fila order by id rows between unbounded preceding and unbounded following)) f
    left join operarios o on o.dni = f.r->>'dni'), '[]'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_tickets_previa(text, text, text, bigint[], date),
                          public.fn_tickets_deshacer(text, text, bigint),
                          public.fn_tickets_cambios_listar(text, text, date, date, text),
                          public.fn_tickets_cambio_detalle(text, text, bigint)
  to anon, authenticated;

commit;
