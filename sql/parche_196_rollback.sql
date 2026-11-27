-- Deshace el parche 196: vuelve a las RPC de tabla del 195 y quita la de varios artículos.
-- El límite de % queda abierto (0-300): no pierde datos.
begin;

create or replace function public.fn_incentivos_tabla_guardar(p_dni text, p_token uuid, p_items jsonb)
returns json language plpgsql security definer set search_path to 'public' as $$
declare o operarios; it jsonb; n int := 0; antes jsonb;
begin
  o := _admin(p_dni, p_token);
  select coalesce(jsonb_agg(to_jsonb(t)), '[]') into antes from incentivos_tabla t;
  for it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into incentivos_tabla(categoria, pct, soles)
    values (upper(it->>'categoria'), (it->>'pct')::int, (it->>'soles')::numeric)
    on conflict (categoria, pct) do update set soles = excluded.soles;
    n := n + 1;
  end loop;
  insert into correcciones_log(dni, tabla, accion, antes)
  values (o.dni, 'incentivos_tabla', 'EDITAR', antes);
  return json_build_object('ok', true, 'filas', n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.fn_bono_modular_tabla_guardar(p_dni text, p_token uuid, p_items jsonb)
returns json language plpgsql security definer set search_path to 'public' as $$
declare o operarios; it jsonb; n int := 0; antes jsonb;
begin
  o := _admin(p_dni, p_token);
  select coalesce(jsonb_agg(to_jsonb(t)), '[]') into antes from bono_modular_tabla t;
  for it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into bono_modular_tabla(pct, soles)
    values ((it->>'pct')::int, (it->>'soles')::numeric)
    on conflict (pct) do update set soles = excluded.soles;
    n := n + 1;
  end loop;
  insert into correcciones_log(dni, tabla, accion, antes)
  values (o.dni, 'bono_modular_tabla', 'EDITAR', antes);
  return json_build_object('ok', true, 'filas', n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;
grant execute on function public.fn_incentivos_tabla_guardar(text, uuid, jsonb) to anon, authenticated;

drop function if exists public.fn_bases_agregar_varios(text, uuid, text, jsonb);

commit;
