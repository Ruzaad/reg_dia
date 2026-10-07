-- Vuelta atrás del PARCHE 102: las RPC de liberar/mover/partir vuelven a como
-- estaban (sin motivo obligatorio ni registro) y se quitan las funciones nuevas
-- y los triggers. Las tablas tickets_cambios y tickets_cambios_det NO se borran:
-- guardan el historial. Si de verdad se quieren borrar:
--   drop table public.tickets_cambios_det; drop table public.tickets_cambios;
begin;

drop trigger if exists tickets_cambio_trg on public.reclamos;
drop trigger if exists tickets_cambio_trg on public.residuales;
drop function if exists public.fn_tickets_previa(text, text, text, bigint[], date);
drop function if exists public.fn_tickets_deshacer(text, text, bigint);
drop function if exists public.fn_tickets_cambios_listar(text, text, date, date, text);
drop function if exists public.fn_tickets_cambio_detalle(text, text, bigint);
drop function if exists public._tc_claves(text, jsonb);

create or replace function public.fn_liberar_ids(p_dni text, p_token text, p_ids bigint[], p_motivo text)
 returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare r record; v_tro json; v_n int := 0; v_k int; v_av json[] := '{}';
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if p_ids is null or array_length(p_ids,1) is null then
    return json_build_object('ok', false, 'error', 'No hay tickets seleccionados'); end if;

  for r in select id, area, codigo from reclamos
            where id = any(p_ids) and estado = 'ACTIVO' order by id loop
    if r.codigo is not null then
      v_tro := _deshacer_troceo(r.area, r.codigo, p_motivo);
      if json_array_length(v_tro->'anulados') > 0 then
        v_av := v_av || json_build_object('codigo', r.codigo,
          'anulados', v_tro->'anulados', 'liberados', v_tro->'liberados');
      end if;
    end if;
    update reclamos
       set estado = 'LIBERADO',
           motivo_liberacion = coalesce(nullif(trim(p_motivo), ''), 'Liberado por ingeniería')
     where id = r.id and estado = 'ACTIVO';
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;

  if v_n = 0 then
    return json_build_object('ok', false, 'error', 'No hay reclamos activos en la selección'); end if;
  return json_build_object('ok', true, 'liberados', v_n,
    'troceos_deshechos', to_json(v_av));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_liberar_ticket(p_dni text, p_token text, p_codigo text, p_motivo text, p_area text default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_area text; v_tro json;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  select area into v_area from reclamos
   where codigo = p_codigo and estado = 'ACTIVO'
     and (p_area is null or area = p_area)
   limit 1;
  if v_area is null then
    return json_build_object('ok', false, 'error', 'No hay un reclamo activo con ese código'); end if;
  v_tro := _deshacer_troceo(v_area, p_codigo, p_motivo);
  update reclamos
     set estado = 'LIBERADO',
         motivo_liberacion = coalesce(nullif(trim(p_motivo), ''), 'Liberado por ingeniería')
   where codigo = p_codigo and estado = 'ACTIVO' and area = v_area;
  return json_build_object('ok', true, 'codigo', p_codigo, 'area', v_area,
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
declare c text; v_area text; v_tro json; v_n int := 0; v_av json[] := '{}';
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if p_codigos is null or array_length(p_codigos,1) is null then
    return json_build_object('ok', false, 'error', 'No hay tickets seleccionados'); end if;
  foreach c in array p_codigos loop
    select area into v_area from reclamos
     where codigo = c and estado = 'ACTIVO'
       and (p_area is null or area = p_area)
     limit 1;
    if v_area is not null then
      v_tro := _deshacer_troceo(v_area, c, p_motivo);
      update reclamos
         set estado = 'LIBERADO',
             motivo_liberacion = coalesce(nullif(trim(p_motivo), ''), 'Liberado en lote por ingeniería')
       where codigo = c and estado = 'ACTIVO' and area = v_area;
      v_n := v_n + 1;
      if json_array_length(v_tro->'anulados') > 0 then
        v_av := v_av || json_build_object('codigo', c,
          'anulados', v_tro->'anulados', 'liberados', v_tro->'liberados');
      end if;
    end if;
  end loop;
  return json_build_object('ok', true, 'liberados', v_n,
    'troceos_deshechos', to_json(v_av));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_reclamos_cambiar_fecha(p_dni text, p_token text, p_ids bigint[], p_fecha date, p_motivo text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_motivo text; v_n int := 0;
begin
  perform fn_validar_ingenieria(p_dni, p_token);
  if p_ids is null or array_length(p_ids,1) is null then
    return json_build_object('ok', false, 'error', 'No hay tickets seleccionados');
  end if;
  v_motivo := upper(trim(coalesce(p_motivo,'')));
  if v_motivo = '' then return json_build_object('ok', false, 'error', 'Indica el motivo'); end if;
  insert into motivos_cambio_fecha(texto) values (v_motivo) on conflict (texto) do nothing;
  update reclamos set fecha = p_fecha, motivo_fecha = v_motivo where id = any(p_ids);
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'cambiados', v_n, 'motivo', v_motivo);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_reclamo_partir(p_dni text, p_token text, p_id bigint, p_cant numeric, p_fecha date, p_motivo text, p_causa text default null)
 returns json language plpgsql security definer set search_path to 'public'
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

drop function if exists public._cambio_cerrar(bigint);
drop function if exists public._cambio_abrir(text, text, bigint);
drop function if exists public._tickets_cambio_trg();

commit;
