-- PARCHE 164 — Costos › Reporte de hoy › Trabajo en curso
-- Problema: el reporte no trae el módulo; hace falta ver por área / prenda / OF (formato Costos)
-- / módulo la cantidad reportada de cada operación, en el orden de la base de Ingeniería.
-- Cambio: fn_costos_en_curso (lectura, nueva). fn_costos_reporte_dia no se toca.
begin;

create or replace function public.fn_costos_en_curso(p_dni text, p_token uuid, p_fecha date, p_area text default '')
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_area text := coalesce(p_area,''); v_r json;
begin
  perform _lector(p_dni, p_token, v_area);
  if p_fecha is null then raise exception 'Indica la fecha'; end if;
  select coalesce(json_agg(json_build_object('area', t.area, 'prenda', o.prenda, 'of', t.o_f, 'articulo', t.art,
           'modulo', t.modulo, 'nop', t.nop, 'op', t.op, 'cant', t.cant, 'minutos', t.minutos,
           'tks', t.tks, 'personas', t.pers)
           order by t.area, o.prenda, t.o_f, t.modulo, t.nop nulls last), '[]'::json)
    into v_r
    from (select r.area, upper(trim(r.articulo)) art, r.o_f, r.modulo, r.nop, r.op,
                 sum(r.cant) cant, round(sum(r.minutos)::numeric, 2) minutos,
                 count(*) tks, count(distinct r.dni) pers
            from reclamos r
           where r.fecha = p_fecha and r.estado = 'ACTIVO' and (v_area = '' or r.area = v_area)
           group by 1,2,3,4,5,6) t
    left join ofs o on o.o_f = t.o_f;
  return json_build_object('ok', true, 'fecha', to_char(p_fecha,'YYYY-MM-DD'), 'items', v_r);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_costos_en_curso(text, uuid, date, text) from public;
grant execute on function public.fn_costos_en_curso(text, uuid, date, text) to anon, authenticated;

commit;
