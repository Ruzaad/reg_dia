-- VUELTA ATRÁS DEL PARCHE 104
-- Borra las mediciones y la base madre. Si solo quieres apagar las pantallas
-- sin perder lo medido, corre únicamente el bloque 1.
begin;

-- 1. Quitar las pestañas (las pantallas desaparecen del menú).
delete from permisos_pestana where pestana in ('pasoTmpMed','pasoTmpFalta','pasoTmpTomar');

-- 2. Funciones y trigger nuevos.
drop trigger if exists tiempos_bases_trg on public.bases;
drop function if exists public._tmp_bases_trg();
drop function if exists public.fn_tiempos_postura(text, uuid, bigint, text);
drop function if exists public.fn_tiempos_aplicar(text, uuid, text, bigint[], text);
drop function if exists public.fn_tiempos_falta(text, uuid, text, integer);
drop function if exists public.fn_tiempos_detalle(text, uuid, bigint);
drop function if exists public.fn_tiempos_medidos(text, uuid, text, text);
drop function if exists public.fn_tiempos_mios(text, uuid, text, date);
drop function if exists public.fn_tiempos_subir(text, uuid, text, jsonb);
drop function if exists public.fn_tiempos_catalogo(text, uuid, text);
drop function if exists public._tmp_analista(text, uuid, text);
drop function if exists public._tmp_sembrar(text, text);
drop view if exists public.tiempos_estandar;

-- 3. Datos. BORRA TODO LO MEDIDO: sáltate este bloque si quieres conservarlo.
drop table if exists public.tiempos_inconvenientes;
drop table if exists public.tiempos_ciclos;
drop table if exists public.tiempos_estudios;
drop table if exists public.tiempos_operaciones;
drop function if exists public._tmp_clave(text);
drop function if exists public._tmp_norm(text);

-- 4. bases_log vuelve a como lo dejó el parche 86.
create or replace function public._bases_log_trg()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_dni text := coalesce(nullif(current_setting('app.dni', true), ''), 'SISTEMA');
begin
  if tg_op = 'INSERT' then
    insert into bases_log (dni, accion, area, articulo, modulo, n_op, operacion, std_antes, std_despues)
    values (v_dni, 'AGREGADA', new.area, new.articulo, new.modulo, new.n_op, new.operacion, null, new.std);
  elsif tg_op = 'DELETE' then
    insert into bases_log (dni, accion, area, articulo, modulo, n_op, operacion, std_antes, std_despues)
    values (v_dni, 'BORRADA', old.area, old.articulo, old.modulo, old.n_op, old.operacion, old.std, null);
  elsif new.std is distinct from old.std then
    insert into bases_log (dni, accion, area, articulo, modulo, n_op, operacion, std_antes, std_despues)
    values (v_dni, 'EDITADO', new.area, new.articulo, new.modulo, new.n_op, new.operacion, old.std, new.std);
  end if;
  return null;
end $function$;

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
           'std_antes', l.std_antes, 'std_despues', l.std_despues)
           order by l.creado desc, l.id desc), '[]'::json)
    into v
    from bases_log l
    left join operarios o on o.dni = l.dni
   where l.creado >= (p_desde::timestamp at time zone 'America/Lima')
     and l.creado <  ((p_hasta + 1)::timestamp at time zone 'America/Lima')
     and (coalesce(p_area, '') = '' or l.area = p_area);

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

alter table public.bases_log drop column if exists origen;
alter table public.bases_log drop column if exists estudio_id;

commit;
