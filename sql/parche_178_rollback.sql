-- ROLLBACK PARCHE 178: quita fn_pcp_costura, deja fn_pcp_programa_cargar sin target/operarios y fn_reclamar / fn_reclamar_lote sin el bloqueo por base.
-- Las columnas pcp_programa.target y .operarios se dejan (vacías no estorban); para quitarlas: alter table public.pcp_programa drop column target, drop column operarios;
begin;

drop function if exists public.fn_pcp_costura(text, uuid, date);

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

-- fn_reclamar y fn_reclamar_lote sin el bloqueo por base (versión del parche 92).
create or replace function public.fn_reclamar(p_dni text, p_token uuid, p_area text, p_codigo text, p_of text, p_modulo text, p_op text, p_std numeric, p_cant numeric, p_numeracion text, p_articulo text, p_color text, p_talla text, p_corte text, p_nop integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o operarios; quien text; cuando text; res residuales; tc tickets_cache; v_esp numeric; v_padre text;
begin
  o := _auth(p_dni, p_token);

  -- El ticket se lee del almacén del área, no del teléfono (parche 92).
  select * into res from residuales where area = p_area and codigo = p_codigo;
  if found then
    v_esp := res.cant; v_padre := res.codigo_padre;
    p_of := res.o_f; p_modulo := res.modulo; p_op := res.op; p_nop := res.nop;
    p_std := res.std; p_articulo := res.articulo;
    p_color := coalesce(res.color, p_color); p_talla := coalesce(res.talla, p_talla);
    p_corte := coalesce(res.corte, p_corte); p_numeracion := coalesce(res.numeracion, p_numeracion);
  else
    select * into tc from tickets_cache where area = p_area and codigo = p_codigo;
    if not found then
      return json_build_object('ok', false,
        'error', 'Ese ticket no está en el almacén de '||coalesce(p_area,'—')||'. Recarga la lista.');
    end if;
    p_of := tc.o_f; p_modulo := tc.modulo; p_op := tc.op; p_nop := tc.n_op;
    p_std := tc.std; p_articulo := tc.articulo; p_color := tc.color; p_talla := tc.talla;
    p_corte := tc.paq::text; p_numeracion := tc.desde::text || '-' || tc.hasta::text;
    v_esp := coalesce(_paq_cant(p_area, p_of, p_nop, tc.paq), tc.cant);
  end if;

  if _modulo_cerrado(p_area, p_of, p_modulo) then
    return json_build_object('ok', false, 'error',
      'El módulo '||coalesce(p_modulo,'')||' (OF '||coalesce(p_of,'')||') está cerrado por ingeniería.');
  end if;

  if v_esp is not null and p_cant is distinct from v_esp then
    return json_build_object('ok', false, 'error',
      'La cantidad no cuadra: el paquete es de '||round(v_esp,0)||' und. Recarga el almacén.');
  end if;

  begin
    insert into reclamos (codigo, codigo_padre, dni, area, o_f, modulo, op, std, cant,
                          cant_asignada, numeracion, articulo, color, talla, corte, nop)
    values (p_codigo, v_padre, o.dni, p_area, p_of, p_modulo, p_op, p_std, p_cant,
            coalesce(v_esp, p_cant), p_numeracion, p_articulo, p_color, p_talla, p_corte, p_nop);
  exception when unique_violation then
    select op2.nombres_apellidos,
           to_char(r.creado at time zone 'America/Lima','HH24:MI')
      into quien, cuando
      from reclamos r join operarios op2 on op2.dni = r.dni
     where r.codigo = p_codigo and r.area = p_area and r.estado = 'ACTIVO' limit 1;
    return json_build_object('ok', false, 'conflicto', true,
      'error', 'Ya lo tomó ' || coalesce(quien,'otra persona') ||
               coalesce(' a las ' || cuando, ''));
  end;
  return (jsonb_build_object('ok', true) || fn_mi_dia(p_dni, p_token)::jsonb)::json;
end $function$;

create or replace function public.fn_reclamar_lote(p_dni text, p_token uuid, p_area text, p_tickets jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o operarios; t jsonb; n int := 0; conflictos text[] := '{}';
        res residuales; tc tickets_cache; v_cod text; v_esp numeric; v_cant numeric;
begin
  o := _auth(p_dni, p_token);
  if jsonb_typeof(p_tickets) <> 'array' or jsonb_array_length(p_tickets) = 0 then
    return json_build_object('ok', false, 'error', 'Lote vacío');
  end if;
  if jsonb_array_length(p_tickets) > 60 then
    return json_build_object('ok', false, 'error', 'Máximo 60 paquetes por lote');
  end if;
  for t in select * from jsonb_array_elements(p_tickets) loop
    v_cod := t->>'codigo';
    v_cant := coalesce((t->>'cant')::numeric, 0);
    begin
      -- El ticket se lee del almacén del área, no del teléfono (parche 92).
      select * into res from residuales where area = p_area and codigo = v_cod;
      if found then
        tc := null;
        tc.o_f := res.o_f; tc.modulo := res.modulo; tc.op := res.op; tc.n_op := res.nop;
        tc.std := res.std; tc.articulo := res.articulo;
        tc.color := coalesce(res.color, t->>'color'); tc.talla := coalesce(res.talla, t->>'talla');
        v_esp := res.cant;
      else
        res := null;
        select * into tc from tickets_cache where area = p_area and codigo = v_cod;
        if not found then
          conflictos := conflictos || ('No está en el almacén: ' || coalesce(t->>'num', v_cod));
          continue;
        end if;
        v_esp := coalesce(_paq_cant(p_area, tc.o_f, tc.n_op, tc.paq), tc.cant);
      end if;

      if _modulo_cerrado(p_area, tc.o_f, tc.modulo) then
        conflictos := conflictos || ('Módulo cerrado: ' || coalesce(t->>'num', v_cod));
        continue;
      end if;
      if v_esp is not null and v_cant is distinct from v_esp then
        conflictos := conflictos || ('Cantidad no cuadra: ' || coalesce(t->>'num', v_cod));
        continue;
      end if;

      insert into reclamos (codigo, codigo_padre, dni, area, o_f, modulo, op, std, cant,
                            numeracion, articulo, color, talla, corte, nop)
      values (v_cod, res.codigo_padre, o.dni, p_area, tc.o_f, tc.modulo, tc.op,
              coalesce(tc.std, 0), v_cant,
              case when res.codigo is not null then coalesce(res.numeracion, t->>'num')
                   else tc.desde::text || '-' || tc.hasta::text end,
              tc.articulo, tc.color, tc.talla,
              case when res.codigo is not null then coalesce(res.corte, t->>'corte')
                   else tc.paq::text end,
              tc.n_op);
      n := n + 1;
    exception when unique_violation then
      conflictos := conflictos || coalesce(t->>'num', v_cod);
    end;
  end loop;
  return (jsonb_build_object('ok', true, 'reclamados', n,
          'conflictos', to_jsonb(conflictos)) || fn_mi_dia(p_dni, p_token)::jsonb)::json;
end $function$;

commit;
