-- PARCHE 134 — Carga vs capacidad: cerrar varias OF a la vez y ver/deshacer las ya cerradas
-- fn_ofs_completar_varias (nueva): igual que fn_of_completar pero para una lista [{area, of}]. Solo INGENIERIA.
-- fn_ofs_completadas (nueva): OFs con módulos cerrados (quién, cuándo, cuántos) para poder reabrirlas.
-- No cambia ninguna función existente.
begin;

create or replace function public.fn_ofs_completar_varias(p_dni text, p_token uuid, p_items jsonb, p_completar boolean)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s operarios; it jsonb; v_n int; v_mod int := 0; v_of int := 0;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(trim(it->>'area'),'') = '' or coalesce(trim(it->>'of'),'') = '' then continue; end if;
    if p_completar then
      insert into modulos_cerrados(area, o_f, modulo, cerrado_por)
      select distinct t.area, t.o_f, upper(trim(t.modulo)), s.dni
        from tickets_cache t
       where t.area = it->>'area' and t.o_f = upper(trim(it->>'of')) and coalesce(trim(t.modulo),'') <> ''
      on conflict (area, o_f, modulo) do nothing;
    else
      delete from modulos_cerrados where area = it->>'area' and upper(trim(o_f)) = upper(trim(it->>'of'));
    end if;
    get diagnostics v_n = row_count;
    v_mod := v_mod + v_n; v_of := v_of + 1;
  end loop;
  return json_build_object('ok', true, 'completada', p_completar, 'ofs', v_of, 'modulos', v_mod);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_ofs_completadas(p_dni text, p_token uuid, p_area text default '')
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare s operarios; v_j json;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  select json_agg(x order by x.creado desc) into v_j from (
    select c.area, c.o_f as of, f.articulo, f.prenda, round(f.cant_prog,0) cant,
           count(*) modulos, p.nombres_apellidos as por,
           to_char(max(c.creado) at time zone 'America/Lima','YYYY-MM-DD HH24:MI') as cuando,
           max(c.creado) as creado
      from modulos_cerrados c
      left join ofs f on f.o_f = c.o_f
      left join operarios p on p.dni = c.cerrado_por
     where coalesce(p_area,'') = '' or c.area = p_area
     group by c.area, c.o_f, f.articulo, f.prenda, f.cant_prog, p.nombres_apellidos) x;
  return json_build_object('ok', true, 'ofs', coalesce(v_j, '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_ofs_completar_varias(text, uuid, jsonb, boolean) to anon, authenticated;
grant execute on function public.fn_ofs_completadas(text, uuid, text) to anon, authenticated;

commit;
