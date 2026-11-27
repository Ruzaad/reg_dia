-- Deshace el parche 199: vuelve a las versiones del 198
-- 1) fn_estructura_candidatos: personal ACTIVO que aún no está en la estructura del mes, con búsqueda
--    por nombre, DNI o usuario (máx. 40 filas; solo lo elegible viaja al front).
-- 2) fn_estructura_agregar: asigna a la estructura a alguien que ya existe y está activo; no crea personal
--    y rechaza el duplicado (la clave mes+dni ya lo impide en la tabla).
-- No se toca ninguna RPC existente (fn_estructura_guardar sigue para editar). Sin tablas nuevas.
-- 
begin;

create or replace function public.fn_estructura_candidatos(p_dni_ing text, p_token text, p_mes date, p_q text default '')
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_q text := trim(coalesce(p_q, '')); v_r json;
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);
  select coalesce(json_agg(x), '[]'::json) into v_r from (
    select o.dni, o.nombres_apellidos as nombre, coalesce(o.area_origen, o.area_actual) as area, o.cargo as rol
      from operarios o
     where o.estado = 'ACTIVO'
       and not exists (select 1 from estructura_mes e where e.mes = v_mes and e.dni = o.dni)
       and (v_q = '' or o.nombres_apellidos ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%'
                     or o.dni ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
     order by o.nombres_apellidos
     limit 40) x;
  return json_build_object('ok', true, 'filas', v_r);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_estructura_agregar(p_dni_ing text, p_token text, p_mes date, p_dni text,
    p_area text, p_subarea text, p_tipo text, p_cargo text, p_desde date, p_nota text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_o operarios%rowtype;
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);
  select * into v_o from operarios where dni = upper(trim(coalesce(p_dni, '')));
  if not found then return json_build_object('ok', false, 'error', 'La persona no está registrada en Personal'); end if;
  if v_o.estado <> 'ACTIVO' then return json_build_object('ok', false, 'error', 'La persona no está activa'); end if;
  if coalesce(trim(p_area), '') = '' then return json_build_object('ok', false, 'error', 'El área es obligatoria'); end if;
  if p_tipo not in ('MOD','MOI') then return json_build_object('ok', false, 'error', 'Tipo debe ser MOD o MOI'); end if;
  if exists (select 1 from estructura_mes where mes = v_mes and dni = v_o.dni) then
    return json_build_object('ok', false, 'error', 'Esta persona ya está en la estructura de este mes');
  end if;
  insert into estructura_mes (mes, dni, nombre, area, subarea, tipo, cargo, desde, nota, actualizado, actualizado_por)
  values (v_mes, v_o.dni, v_o.nombres_apellidos, upper(trim(p_area)), nullif(upper(trim(coalesce(p_subarea, ''))), ''), p_tipo,
          nullif(upper(trim(coalesce(p_cargo, ''))), ''), p_desde, nullif(trim(coalesce(p_nota, '')), ''), now(), p_dni_ing);
  return json_build_object('ok', true);
exception
  when unique_violation then return json_build_object('ok', false, 'error', 'Esta persona ya está en la estructura de este mes');
  when others then
    if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
    return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
