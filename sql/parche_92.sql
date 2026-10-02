-- PARCHE 92 — Tickets a nombre de quien no los hizo
--
-- 1) Solo personal de planta (OPERARIO, ESTAJERO) puede tener filas en
--    `reclamos`. Hubo tickets de CAMISA COSTURA registrados con el DNI de
--    ingeniería (LFABIAN: 4, 17 y 25 de setiembre). La validación vive en la
--    base porque los tres despliegues (Vercel, Netlify, GitHub Pages) llaman a
--    las mismas RPC con versiones distintas del front.
--
-- 2) fn_reclamar y fn_reclamar_lote ya no confían en lo que manda el teléfono.
--    OF, módulo, operación, N°OP, STD, artículo y cantidad se toman del almacén
--    de ESA área (`tickets_cache`, o `residuales` si es un saldo). Un código que
--    no está en el almacén del área se rechaza. Antes el insert copiaba lo que
--    llegara: una lista vieja o de otra área quedaba registrada tal cual.
--    Firmas sin cambio: el front de hoy sigue funcionando.
--
-- 3) LFABIAN quedó con area_actual = CAMISA COSTURA por esos registros; vuelve a
--    INGENIERIA.

begin;

-- 1) Guardia en la tabla: cubre fn_reclamar, fn_reclamar_lote,
--    fn_acabado_registrar, fn_extra_registrar, fn_opad_registrar y cualquier
--    insert futuro.
create or replace function public._reclamo_solo_planta()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_cargo text; v_nom text;
begin
  select cargo, nombres_apellidos into v_cargo, v_nom from operarios where dni = new.dni;
  if v_cargo is distinct from 'OPERARIO' and v_cargo is distinct from 'ESTAJERO' then
    raise exception 'Estás con el usuario de % (%). Los tickets solo se registran con el usuario del operario.',
      coalesce(v_nom, new.dni), coalesce(v_cargo, 'sin cargo');
  end if;
  return new;
end $$;

drop trigger if exists reclamos_solo_planta_trg on public.reclamos;
create trigger reclamos_solo_planta_trg before insert on public.reclamos
  for each row execute function public._reclamo_solo_planta();

-- 2a) Reclamo individual
create or replace function public.fn_reclamar(p_dni text, p_token uuid, p_area text, p_codigo text, p_of text, p_modulo text, p_op text, p_std numeric, p_cant numeric, p_numeracion text, p_articulo text, p_color text, p_talla text, p_corte text, p_nop integer default null::integer)
returns json language plpgsql security definer set search_path to 'public' as $function$
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

-- 2b) Reclamo en lote
create or replace function public.fn_reclamar_lote(p_dni text, p_token uuid, p_area text, p_tickets jsonb)
returns json language plpgsql security definer set search_path to 'public' as $function$
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

-- 3) Ingeniería no es personal de un área de costura.
update operarios set area_actual = 'INGENIERIA'
 where cargo = 'INGENIERIA' and area_actual is distinct from 'INGENIERIA';

commit;
