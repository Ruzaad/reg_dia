-- PARCHE 178 — PCP: cronograma de costura (reemplaza el calendario) y bloqueo de reclamo sin base.
-- 1) pcp_programa: columnas target (fecha) y operarios (#OPERARIOS del Excel). fn_pcp_programa_cargar (misma firma) las guarda.
-- 2) fn_pcp_costura (lectura): filas del programa de costura por semana de INI COSTURA con STD del balance (suma de la base del artículo),
--    MIN X DIA = estructura de la línea × 9,57 h × 60 (la línea es el grupo de una supervisora: ANA, DORIS, MARIAELENA = MOD de su área en la estructura; los talleres no tienen estructura), DIAS HABILES = CANT PROG × STD ÷ MIN X DIA, STATUS = avance de la penúltima operación y OBSERVACIÓN.
-- 3) fn_reclamar y fn_reclamar_lote (misma firma): en COSTURA no dejan reclamar un artículo sin base de operaciones.
-- No toca fn_pcp_calendario* (se retiran en el parche 179). Rollback: parche_178_rollback.sql
begin;

alter table public.pcp_programa add column if not exists target date;
alter table public.pcp_programa add column if not exists operarios numeric;

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
                            cant, cant_prog, std, ini_costura, fin_costura, mes, anio, estatus, observacion, target, operarios)
  select upper(trim(x->>'area')), x->>'planta', x->>'linea', x->>'prenda', x->>'cliente', x->>'pedido',
         upper(trim(x->>'articulo')), x->>'modelo', x->>'color', nullif(trim(x->>'of'), ''),
         nullif(x->>'cant', '')::numeric, coalesce(nullif(x->>'cant_prog', '')::numeric, 0),
         coalesce(nullif(x->>'std', '')::numeric, 0),
         nullif(x->>'ini', '')::date, nullif(x->>'fin', '')::date,
         nullif(x->>'mes', '')::int, nullif(x->>'anio', '')::int,
         nullif(trim(x->>'estatus'), ''), nullif(trim(x->>'obs'), ''),
         nullif(x->>'target', '')::date, nullif(x->>'operarios', '')::numeric
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

create or replace function public.fn_pcp_costura(p_dni text, p_token uuid, p_mes date default null)
 returns json language plpgsql stable security definer set search_path to 'public'
 set statement_timeout to '20s'
as $function$
declare
  o operarios; v_hoy date := _hoy(); v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date;
  v_d date; v_h date; v_filas json; v_metas json;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  v_d := date_trunc('week', v_mes)::date;
  v_h := (date_trunc('week', (v_mes + interval '1 month - 1 day')::date) + interval '6 days')::date;
  with u as materialized (select area, k, n2 from _ultimas('')),
  pr as (
    select p.*, _nk(p.articulo) k, _of_planta(p.o_f) ofp
      from pcp_programa p
     where p.area like '%COSTURA'
       and (p.ini_costura between v_d and v_h or (p.ini_costura is null and v_mes = date_trunc('month', v_hoy)::date))),
  x as (
    select pr.*,
      bb.n_base, bb.std_base,
      (select count(*) from bases b where b.area <> pr.area and _nk(b.articulo) = pr.k) n_otra,
      (select o2.o_f from ofs o2 where o2.o_f = pr.ofp) of_ok,
      uu.n2,
      (select sum(r.cant) from reclamos r where r.o_f = pr.ofp and r.area = pr.area and r.estado = 'ACTIVO' and r.nop = uu.n2) hecho,
      (select count(*) from reclamos r where r.o_f = pr.ofp and r.area = pr.area and r.estado = 'ACTIVO') n_recl,
      case when nullif(trim(pr.linea), '') is null or trim(pr.linea) = '-' then null
           when not exists (select 1 from operarios s where s.cargo = 'SUPERVISORA' and s.area_actual = pr.area
                              and position(_nk(pr.linea) in _nk(s.nombres_apellidos)) > 0) then null
           else nullif((select count(*) from estructura_mes e
                 where e.tipo = 'MOD' and e.area = pr.area and e.mes = date_trunc('month', coalesce(pr.ini_costura, v_hoy))::date
                   and (e.desde is null or e.desde <= coalesce(pr.ini_costura, v_hoy))
                   and (e.hasta is null or e.hasta >= coalesce(pr.ini_costura, v_hoy))), 0) end est
      from pr
      left join u uu on uu.area = pr.area and uu.k = pr.k
      left join lateral (
        select count(*) n_base, sum(b.std) filter (where q.np <= 1 or _nk(b.prenda) = _nk(pr.prenda)) std_base
          from bases b, lateral (select count(distinct _nk(b2.prenda)) np from bases b2 where b2.area = pr.area and _nk(b2.articulo) = pr.k) q
         where b.area = pr.area and _nk(b.articulo) = pr.k) bb on true),
  y as (
    select x.*, nullif(x.std_base, 0) std_b,
      case when x.est > 0 then x.est * 9.57 * 60 end min_dia,
      case when x.n2 is not null and x.of_ok is not null and x.cant_prog > 0 and (coalesce(x.hecho, 0) > 0 or x.ini_costura <= v_hoy)
           then round(least(100, coalesce(x.hecho, 0) / x.cant_prog * 100)) end status
      from x)
  select json_agg(json_build_object(
      'id', y.id, 'planta', y.planta, 'linea', y.linea, 'prenda', y.prenda, 'cliente', y.cliente, 'articulo', y.articulo,
      'modelo', y.modelo, 'color', y.color, 'o_f', y.o_f, 'target', y.target, 'cant_prog', y.cant_prog,
      'std', y.std_b, 'std_prog', y.std, 'est', y.est, 'min_dia', round(y.min_dia),
      'dias', case when y.std_b is not null and y.min_dia is not null and y.cant_prog > 0 then round(y.cant_prog * y.std_b / y.min_dia, 1) end,
      'ini', y.ini_costura, 'fin', y.fin_costura, 'area', y.area, 'hecho', y.hecho, 'status', y.status,
      'bloquea', y.n_base = 0,
      'obs', array_remove(array[
        case when y.o_f is null then 'PROGRAMA SIN OF' end,
        case when y.cant_prog <= 0 or y.ini_costura is null or y.fin_costura is null then 'DATOS INCOMPLETOS EN EL PROGRAMA' end,
        case when y.n_base = 0 and y.n_otra = 0 then 'ARTÍCULO NO REGISTRADO EN CHRONOS'
             when y.n_base = 0 then 'SIN BASE DE OPERACIONES' end,
        case when y.n_base > 0 and y.std_b is null then 'STD NO ENCONTRADO EN BALANCE DE LÍNEA' end,
        case when y.o_f is not null and y.of_ok is null then 'OF NO CREADA EN CHRONOS' end,
        case when y.n_base > 0 and y.n2 is null then 'NO SE IDENTIFICA LA SECUENCIA DE OPERACIONES' end,
        case when y.est is null and y.linea is not null and trim(y.linea) <> '-' then 'ESTRUCTURA DE LÍNEA NO DISPONIBLE'
             when y.linea is null or trim(y.linea) = '-' then 'LÍNEA NO ASIGNADA EN EL PROGRAMA' end,
        case when y.of_ok is not null and y.n_recl = 0 and y.ini_costura <= v_hoy then 'SIN REGISTROS DE PRODUCCIÓN' end,
        case when y.of_ok is not null and y.n2 is not null and y.status is null and y.n_recl > 0 then 'NO SE PUEDE CALCULAR EL STATUS' end
      ], null)) order by y.ini_costura nulls last, y.planta, y.linea, y.o_f)
    into v_filas from y;
  select coalesce(json_object_agg(case when alcance = 'CORPORACION' then 'PLANTA' else area end, meta_minutos), '{}'::json)
    into v_metas from metas_mes where mes = v_mes;
  return json_build_object('ok', true, 'hoy', v_hoy, 'mes', v_mes, 'desde', v_d, 'hasta', v_h,
    'puede_editar', coalesce(o.es_admin, false) or exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR'),
    'metas', v_metas, 'filas', coalesce(v_filas, '[]'::json),
    'carga', (select json_build_object('archivo', archivo, 'filas', filas, 'cargado_en', cargado_en) from pcp_cargas where tipo = 'PROGRAMA'));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_pcp_costura(text, uuid, date) from public;
grant execute on function public.fn_pcp_costura(text, uuid, date) to anon, authenticated;

-- Reclamo: en COSTURA no se toma un paquete de un artículo sin base de operaciones.
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

  if p_area like '%COSTURA' and nullif(trim(p_articulo), '') is not null
     and not exists (select 1 from bases b where b.area = p_area and _nk(b.articulo) = _nk(p_articulo)) then
    return json_build_object('ok', false, 'error',
      'El artículo '||p_articulo||' no tiene base de operaciones en '||p_area||'. No se puede reclamar: avisa a Ingeniería.');
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

      if p_area like '%COSTURA' and nullif(trim(tc.articulo), '') is not null
         and not exists (select 1 from bases b where b.area = p_area and _nk(b.articulo) = _nk(tc.articulo)) then
        conflictos := conflictos || ('Artículo sin base de operaciones: ' || tc.articulo);
        continue;
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
