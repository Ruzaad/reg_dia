-- Parche 145: fn_pcp_programa_cargar fallaba con «DELETE requires a WHERE clause» (la base rechaza DELETE sin WHERE).
begin;

/* Reemplaza el programa de costura vigente por el del archivo. */
create or replace function public.fn_pcp_programa_cargar(p_dni text, p_token uuid, p_archivo text, p_filas jsonb)
 returns json language plpgsql security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare o operarios; v_n int;
begin
  o := _pcp_editor(p_dni, p_token);
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'El archivo no trae filas de programa');
  end if;
  if jsonb_array_length(p_filas) > 5000 then
    return json_build_object('ok', false, 'error', 'Máximo 5000 filas por programa');
  end if;
  delete from pcp_programa where true;
  insert into pcp_programa (area, planta, linea, prenda, cliente, pedido, articulo, modelo, color, o_f,
                            cant, cant_prog, std, ini_costura, fin_costura, mes, anio, estatus, observacion)
  select upper(trim(x->>'area')), x->>'planta', x->>'linea', x->>'prenda', x->>'cliente', x->>'pedido',
         upper(trim(x->>'articulo')), x->>'modelo', x->>'color', nullif(trim(x->>'of'), ''),
         nullif(x->>'cant', '')::numeric, coalesce(nullif(x->>'cant_prog', '')::numeric, 0),
         coalesce(nullif(x->>'std', '')::numeric, 0),
         nullif(x->>'ini', '')::date, nullif(x->>'fin', '')::date,
         nullif(x->>'mes', '')::int, nullif(x->>'anio', '')::int,
         nullif(trim(x->>'estatus'), ''), nullif(trim(x->>'obs'), '')
    from jsonb_array_elements(p_filas) x
   where nullif(trim(x->>'area'), '') is not null;
  get diagnostics v_n = row_count;
  insert into pcp_cargas (tipo, archivo, filas, desde, hasta, cargado_por, cargado_en)
  select 'PROGRAMA', left(p_archivo, 200), v_n, min(ini_costura), max(fin_costura), o.dni, now() from pcp_programa
  on conflict (tipo) do update set archivo = excluded.archivo, filas = excluded.filas, desde = excluded.desde,
    hasta = excluded.hasta, cargado_por = excluded.cargado_por, cargado_en = excluded.cargado_en;
  return json_build_object('ok', true, 'filas', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
