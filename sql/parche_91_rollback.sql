-- Vuelta atrás del parche 91. Borra las operaciones adicionales y los
-- registros que el personal hizo sobre ellas (sus minutos dejan de contar).
delete from public.reclamos where op_adicional_id is not null;
drop function if exists public.fn_opad_registrar(text, uuid, text, bigint, numeric);
drop function if exists public.fn_opad_guardar(text, uuid, bigint, text, text, text, text, numeric, numeric, text, text, boolean);
drop function if exists public.fn_opad_listar(text, uuid, text, text);
drop function if exists public._opad_modulos(text, text);

create or replace function public._reclamo_op_id()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.op_id is null and new.articulo is not null then
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
  update reclamos r
     set nop = b.n_op, modulo = b.modulo, op_id = b.op_id,
         std_base = case when r.causa is null then null else b.std end,
         std = case when r.causa is null then b.std
                    else b.std + coalesce((select c.delta from causas_std c
                                            where c.texto = r.causa), 0) end
    from bases b
   where r.op_id is null
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
                        estado, fecha, motivo_fecha)
  values (null, r.dni, r.area, r.o_f, r.modulo, r.op, v_std, p_cant, r.numeracion,
          r.articulo, r.color, r.talla, r.corte, r.nop, r.op_id, v_causa,
          case when v_causa is null then null else v_base end,
          'ACTIVO', v_fecha, v_mot)
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
                  group by o_f) c on c.o_f = t.o_f
      where t.area = p_area
      group by t.o_f) z), '[]'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

drop index if exists public.reclamos_op_adicional_idx;
alter table public.reclamos drop column if exists op_adicional_id;
drop table if exists public.ops_adicionales_of;
