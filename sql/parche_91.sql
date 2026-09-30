-- PARCHE 91 — Operaciones ADICIONALES por OF en costura (no valorizadas)
--
-- Por fallas de otra área, a veces en costura hay que hacer operaciones que no
-- están en la BASE del artículo (descoser, rehacer, reponer una pieza...). No
-- se agregan a la BASE porque no siempre pasan: el artículo no se revaloriza.
-- Pero el minuto sí lo trabajó alguien, y debe quedar ligado a la OF.
--
-- Diferencia con "Operaciones sin OF" (parche 27, ACABADO): aquellas son un
-- catálogo fijo por área y el registro va sin OF. Estas las da de alta
-- Ingeniería PARA UNA OF concreta, en un módulo de su BASE, con su STD, una
-- cantidad autorizada opcional y el motivo (y el área que falló).
--
-- El registro del operario es una fila más de `reclamos`, sin código ni N°OP y
-- con `op_adicional_id`. Así:
--   · suma sus minutos al día de la persona (eficiencia, incentivos) como
--     cualquier otro registro;
--   · no cuenta como avance de la ruta: todo el avance se calcula por N°OP y
--     estas filas no lo tienen;
--   · el módulo es siempre uno de la BASE del artículo, así que no aparece un
--     módulo "fantasma" que deje la OF sin terminar en el resumen de OF.
--
-- Protecciones en funciones existentes (una línea en cada una):
--   · _reclamo_op_id: si el nombre coincidiera con una operación de la BASE le
--     pondría op_id y, en la siguiente edición de la BASE, le cambiarían STD,
--     módulo y N°OP (contaría como avance). Se salta estas filas.
--   · _sync_reclamos_articulo: mismo riesgo en el respaldo "por nombre".
--   · fn_reclamo_partir: al partir una fila, la nueva conserva op_adicional_id.
--   · fn_ofs_area: el "N libres de M" resta reclamos por OF; solo cuenta los
--     que tienen código (tickets), no las adicionales.

-- 1) Tabla ----------------------------------------------------------------
create table if not exists public.ops_adicionales_of (
  id          bigserial primary key,
  area        text not null,
  o_f         text not null,
  articulo    text,
  modulo      text not null,
  operacion   text not null,
  std         numeric not null check (std > 0),
  tope        numeric check (tope is null or tope > 0),
  motivo      text not null,
  area_origen text,
  activa      boolean not null default true,
  creado_por  text,
  creado      timestamptz not null default now(),
  unique (area, o_f, modulo, operacion)
);
alter table public.ops_adicionales_of enable row level security;
revoke all on public.ops_adicionales_of from anon, authenticated;
create index if not exists ops_adicionales_of_area_of_idx
  on public.ops_adicionales_of (area, o_f);

alter table public.reclamos
  add column if not exists op_adicional_id bigint references public.ops_adicionales_of(id);
create index if not exists reclamos_op_adicional_idx
  on public.reclamos (op_adicional_id) where op_adicional_id is not null;

-- 2) Protecciones -------------------------------------------------------------
create or replace function public._reclamo_op_id()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.op_id is null and new.articulo is not null and new.op_adicional_id is null then
    select b.op_id into new.op_id
      from bases b
     where b.area = new.area
       and _nk(b.articulo) = _nk(new.articulo)
       and (_nk(b.operacion) = _nk(new.op) or b.n_op = new.nop)
     order by (case when _nk(b.operacion) = _nk(new.op) then 0 else 1 end), b.id
     limit 1;
  end if;
  return new;
end $function$;

create or replace function public._sync_reclamos_articulo(p_area text, p_articulo text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v int; w int;
begin
  -- 1) Por identidad: sobrevive a renombres y reordenamientos.
  update reclamos r
     set nop = b.n_op, modulo = b.modulo, op = b.operacion,
         std_base = case when r.causa is null then null else b.std end,
         std = case when r.causa is null then b.std
                    else b.std + coalesce((select c.delta from causas_std c
                                            where c.texto = r.causa), 0) end
    from bases b
   where b.op_id = r.op_id
     and b.area = p_area and upper(trim(b.articulo)) = upper(trim(p_articulo))
     and r.area = p_area;
  get diagnostics v = row_count;

  -- 2) Respaldo por nombre para lo que aún no tiene op_id (histórico).
  --    Las adicionales por OF (parche 91) no son de la BASE: nunca se enlazan.
  update reclamos r
     set nop = b.n_op, modulo = b.modulo, op_id = b.op_id,
         std_base = case when r.causa is null then null else b.std end,
         std = case when r.causa is null then b.std
                    else b.std + coalesce((select c.delta from causas_std c
                                            where c.texto = r.causa), 0) end
    from bases b
   where r.op_id is null and r.op_adicional_id is null
     and b.area = p_area and upper(trim(b.articulo)) = upper(trim(p_articulo))
     and r.area = p_area and upper(trim(r.articulo)) = upper(trim(p_articulo))
     and upper(trim(r.op)) = upper(trim(b.operacion));
  get diagnostics w = row_count;

  return v + w;
end $function$;

create or replace function public.fn_reclamo_partir(p_dni text, p_token text, p_id bigint, p_cant numeric, p_fecha date, p_motivo text, p_causa text DEFAULT NULL::text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r reclamos; v_mot text; v_new bigint; v_fecha date;
        v_causa text; v_delta numeric := 0; v_base numeric; v_std numeric;
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

  -- Partir sin mover la fecha solo tiene sentido si cambia la causa: es el caso
  -- de "de estas 500, 200 fueron con falta de vapor".
  if v_fecha = r.fecha and v_causa is not distinct from r.causa then
    return json_build_object('ok',false,'error',
      'No cambia nada: elige otra fecha, otra causa, o las dos'); end if;

  if v_causa is not null then
    select c.delta into v_delta from causas_std c where c.texto = v_causa and c.activa;
    if not found then
      return json_build_object('ok',false,'error','Esa causa no existe o está desactivada'); end if;
  end if;

  -- El STD de la BASE es el que tenía antes de cualquier causa.
  v_base := coalesce(r.std_base, r.std);
  v_std  := v_base + coalesce(v_delta,0);
  if v_std <= 0 then
    return json_build_object('ok',false,'error','La causa deja el STD en cero o negativo'); end if;

  v_mot := nullif(upper(trim(coalesce(p_motivo,''))), '');
  if v_mot is null then return json_build_object('ok',false,'error','Indica el motivo'); end if;
  insert into motivos_cambio_fecha(texto) values (v_mot) on conflict (texto) do nothing;

  -- El resto se queda como estaba; la parte separada nace como fila nueva.
  update reclamos set cant = cant - p_cant where id = r.id;

  insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant, numeracion,
                        articulo, color, talla, corte, nop, op_id, causa, std_base,
                        estado, fecha, motivo_fecha, op_adicional_id)
  values (null, r.dni, r.area, r.o_f, r.modulo, r.op, v_std, p_cant, r.numeracion,
          r.articulo, r.color, r.talla, r.corte, r.nop, r.op_id, v_causa,
          case when v_causa is null then null else v_base end,
          'ACTIVO', v_fecha, v_mot, r.op_adicional_id)
  returning id into v_new;

  return json_build_object('ok', true, 'id_original', r.id, 'id_nuevo', v_new,
    'queda', round(r.cant - p_cant, 0), 'movido', round(p_cant, 0),
    'fecha', v_fecha, 'causa', v_causa, 'std', round(v_std,2));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_ofs_area(p_dni text, p_token uuid, p_area text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return coalesce((
    select json_agg(json_build_object(
        'of', z.o_f, 'articulo', z.articulo,
        'total', z.total, 'libres', z.libres) order by z.o_f)
    from (
      select t.o_f, max(t.articulo) articulo, count(*) total,
             greatest(count(*) - coalesce(max(c.n),0), 0) libres
      from tickets_cache t
      left join (select o_f, count(*) n from reclamos
                  where area = p_area and estado = 'ACTIVO' and o_f is not null
                    and codigo is not null
                  group by o_f) c on c.o_f = t.o_f
      where t.area = p_area
      group by t.o_f) z), '[]'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- 3) RPCs nuevas ----------------------------------------------------------------

-- Módulos de la BASE del artículo de una OF, en el área. Solo para uso interno.
create or replace function public._opad_modulos(p_area text, p_articulo text)
 returns text[]
 language sql stable
 set search_path to 'public'
as $function$
  select coalesce(array_agg(distinct upper(trim(b.modulo)) order by upper(trim(b.modulo))), '{}')
    from bases b
   where b.area = p_area and _nk(b.articulo) = _nk(p_articulo)
     and coalesce(b.n_op,0) > 0 and coalesce(trim(b.modulo),'') <> '';
$function$;
revoke all on function public._opad_modulos(text, text) from public, anon, authenticated;

/* Lista las adicionales.
   - Operario (cualquier sesión): p_of obligatorio, solo las activas, con lo
     que va hecho y lo que queda.
   - Ingeniería: también las inactivas, quién las hizo y, sin OF, las de los
     últimos 60 días del área. Con OF devuelve además los módulos de su BASE
     para el formulario de alta. */
create or replace function public.fn_opad_listar(p_dni text, p_token uuid, p_area text, p_of text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare s operarios; v_ing boolean; v_of text; v_art text; v json;
begin
  s := _auth(p_dni, p_token);
  v_ing := s.cargo = 'INGENIERIA';
  v_of := nullif(trim(coalesce(p_of,'')), '');
  if coalesce(trim(p_area),'') = '' then
    return json_build_object('ok', false, 'error', 'Elige el área'); end if;
  if v_of is null and not v_ing then
    return json_build_object('ok', false, 'error', 'Elige la OF'); end if;

  if v_of is not null then
    select f.o_f, f.articulo into v_of, v_art from ofs f where _nk(f.o_f) = _nk(v_of) limit 1;
    if not found and v_ing then
      return json_build_object('ok', false, 'error', 'Esa OF no está registrada'); end if;
    v_of := coalesce(v_of, trim(p_of));
  end if;

  with ad as (
    select a.* from ops_adicionales_of a
     where a.area = p_area
       and (case when v_of is null then a.creado >= now() - interval '60 days'
                 else _nk(a.o_f) = _nk(v_of) end)
       and (v_ing or a.activa)
  ),
  rc as (
    select r.op_adicional_id id, r.dni, sum(r.cant) cant, sum(r.minutos) minutos,
           max(r.creado) ultimo
      from reclamos r
     where r.op_adicional_id in (select id from ad) and r.estado = 'ACTIVO'
     group by 1, 2
  )
  select coalesce(json_agg(json_build_object(
      'id', a.id, 'of', a.o_f, 'articulo', a.articulo, 'modulo', a.modulo,
      'operacion', a.operacion, 'std', a.std, 'tope', a.tope,
      'motivo', a.motivo, 'area_origen', a.area_origen, 'activa', a.activa,
      'hecho', coalesce((select sum(c.cant) from rc c where c.id = a.id), 0),
      'minutos', case when v_ing then round(coalesce((select sum(c.minutos) from rc c where c.id = a.id), 0), 1) end,
      'restante', case when a.tope is null then null
                       else greatest(a.tope - coalesce((select sum(c.cant) from rc c where c.id = a.id), 0), 0) end,
      'creado', to_char(a.creado at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'),
      'creado_por', case when v_ing then (select o.nombres_apellidos from operarios o where o.dni = a.creado_por) end,
      'personas', case when v_ing then coalesce((
          select json_agg(json_build_object('dni', c.dni,
                   'nombre', (select o.nombres_apellidos from operarios o where o.dni = c.dni),
                   'cant', round(c.cant, 0), 'minutos', round(c.minutos, 1))
                   order by c.cant desc)
            from rc c where c.id = a.id), '[]'::json) end)
      order by a.activa desc, a.o_f, a.modulo, a.operacion), '[]'::json)
    into v from ad a;

  return json_build_object('ok', true, 'items', v,
    'of', v_of, 'articulo', v_art,
    'modulos', case when v_ing and v_art is not null then to_json(_opad_modulos(p_area, v_art)) end);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* Alta (p_id null) o edición. Al editar solo cambian STD, tope, motivo, área
   de origen y si está activa; si cambia el STD, se lleva a lo ya registrado
   (igual que cuando Ingeniería corrige la BASE). */
create or replace function public.fn_opad_guardar(
  p_dni text, p_token uuid, p_id bigint, p_area text, p_of text, p_modulo text,
  p_operacion text, p_std numeric, p_tope numeric, p_motivo text,
  p_area_origen text, p_activa boolean)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s operarios; a ops_adicionales_of; v_of text; v_art text; v_mod text; v_op text;
        v_mot text; v_ori text; v_hecho numeric; v_nop int; v_id bigint;
begin
  s := _ing(p_dni, p_token);
  v_mot := nullif(upper(trim(coalesce(p_motivo,''))), '');
  v_ori := nullif(upper(trim(coalesce(p_area_origen,''))), '');
  if coalesce(p_std,0) <= 0 then
    return json_build_object('ok',false,'error','El STD debe ser mayor que cero'); end if;
  if p_tope is not null and p_tope <= 0 then
    return json_build_object('ok',false,'error','La cantidad autorizada debe ser mayor que cero, o déjala vacía'); end if;
  if v_mot is null then
    return json_build_object('ok',false,'error','Escribe el motivo'); end if;

  if p_id is not null then
    select * into a from ops_adicionales_of where id = p_id for update;
    if not found then return json_build_object('ok',false,'error','No existe esa operación'); end if;
    select coalesce(sum(cant),0) into v_hecho from reclamos
     where op_adicional_id = a.id and estado = 'ACTIVO';
    if p_tope is not null and p_tope < v_hecho then
      return json_build_object('ok',false,'error',
        'Ya se registraron '||round(v_hecho,0)||' und: la cantidad autorizada no puede ser menor'); end if;
    update ops_adicionales_of
       set std = p_std, tope = p_tope, motivo = v_mot, area_origen = v_ori,
           activa = coalesce(p_activa, activa)
     where id = a.id;
    if p_std <> a.std then
      update reclamos
         set std = case when causa is null then p_std
                        else p_std + coalesce((select c.delta from causas_std c
                                                where c.texto = reclamos.causa), 0) end,
             std_base = case when causa is null then null else p_std end
       where op_adicional_id = a.id;
    end if;
    return json_build_object('ok', true, 'id', a.id);
  end if;

  if coalesce(trim(p_area),'') = '' then
    return json_build_object('ok',false,'error','Elige el área'); end if;
  if p_area = 'ACABADO' then
    return json_build_object('ok',false,'error','En ACABADO usa Operaciones sin OF'); end if;
  select f.o_f, f.articulo into v_of, v_art from ofs f where _nk(f.o_f) = _nk(p_of) limit 1;
  if not found then return json_build_object('ok',false,'error','Esa OF no está registrada'); end if;
  if v_art is null then return json_build_object('ok',false,'error','La OF no tiene artículo'); end if;

  v_mod := upper(trim(coalesce(p_modulo,'')));
  v_op  := upper(trim(coalesce(p_operacion,'')));
  if v_op = '' then return json_build_object('ok',false,'error','Escribe la operación'); end if;
  if cardinality(_opad_modulos(p_area, v_art)) = 0 then
    return json_build_object('ok',false,'error','El artículo '||v_art||' no tiene BASE en '||p_area); end if;
  if not (v_mod = any(_opad_modulos(p_area, v_art))) then
    return json_build_object('ok',false,'error','Elige un módulo de la BASE del artículo'); end if;

  select b.n_op into v_nop from bases b
   where b.area = p_area and _nk(b.articulo) = _nk(v_art) and _nk(b.operacion) = _nk(v_op)
   order by b.id limit 1;
  if found then
    return json_build_object('ok',false,'error',
      'Esa operación ya está en la BASE del artículo (N°OP '||coalesce(v_nop::text,'—')||
      '): sale en sus tickets, no hace falta agregarla'); end if;

  insert into ops_adicionales_of (area, o_f, articulo, modulo, operacion, std, tope,
                                  motivo, area_origen, activa, creado_por)
  values (p_area, v_of, v_art, v_mod, v_op, p_std, p_tope, v_mot, v_ori,
          coalesce(p_activa, true), s.dni)
  on conflict (area, o_f, modulo, operacion) do nothing
  returning id into v_id;
  if v_id is null then
    return json_build_object('ok',false,'error','Esa operación ya está agregada a la OF en ese módulo'); end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* Registro del operario: una fila de reclamos sin código ni N°OP. */
create or replace function public.fn_opad_registrar(p_dni text, p_token uuid, p_area text, p_id bigint, p_cant numeric)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o operarios; a ops_adicionales_of; v_hecho numeric;
begin
  o := _auth(p_dni, p_token);
  if coalesce(p_cant,0) <= 0 then
    return json_build_object('ok',false,'error','Indica una cantidad mayor que cero'); end if;
  -- Bloquea la fila: dos personas registrando a la vez no pasan el tope.
  select * into a from ops_adicionales_of
   where id = p_id and area = p_area and activa for update;
  if not found then
    return json_build_object('ok',false,'error','Operación no disponible'); end if;
  select coalesce(sum(cant),0) into v_hecho from reclamos
   where op_adicional_id = a.id and estado = 'ACTIVO';
  if a.tope is not null and v_hecho + p_cant > a.tope then
    return json_build_object('ok',false,'error',
      case when a.tope - v_hecho <= 0 then 'Ya se completó la cantidad autorizada'
           else 'Solo quedan '||round(a.tope - v_hecho,0)||' und autorizadas' end); end if;

  insert into reclamos (codigo, dni, area, o_f, modulo, op, std, cant, articulo, op_adicional_id)
  values (null, o.dni, p_area, a.o_f, a.modulo, a.operacion, a.std, p_cant, a.articulo, a.id);

  return (jsonb_build_object('ok', true, 'hecho', v_hecho + p_cant, 'tope', a.tope)
          || fn_mi_dia(p_dni, p_token)::jsonb)::json;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
