-- PARCHE 70 — Supervisión: quién reclamó (OF → módulo → operación)
--
-- POR QUÉ
--   La supervisora no tenía forma de responder "¿quién reclamó esto?" sin pedirle
--   a ingeniería que mirara Tickets del día. Necesita llegar por OF y acotar.
--
-- LA REGLA DE LOS FILTROS
--   Sin OF no se devuelve NADA de detalle (ni módulos, ni operaciones, ni filas):
--   la lista de OF es lo único que sale. A partir de ahí cada filtro acota el
--   siguiente, y la misma llamada trae las opciones del filtro que viene y las
--   filas que ya calzan, así que el frontend no encadena consultas.
--
-- DE DÓNDE SALEN LAS OF
--   De `reclamos`, no de `tickets_cache`: ACABADO no pasa por el almacén y con
--   tickets_cache su lista saldría vacía (ver parche 67). Además así solo se
--   ofrecen OF que de verdad tienen algo reclamado.
--
-- ACABADO
--   Sus reclamos no llevan numeración (2.280 de 4.316 la tienen, y son los
--   antiguos, de cuando ACABADO sí usaba almacén). Se devuelven las dos columnas
--   y `es_acabado` para que el frontend muestre CANTIDAD en vez de numeración.
--
-- TOPE DE FILAS
--   Una OF de costura llega a ~2.000 reclamos y esto se ve en el celular. Se
--   devuelven como mucho 400 filas, con `total` aparte para poder decir
--   "mostrando 400 de 2.062 · afina por módulo u operación".
--
-- OPERACIONES SIN N°OP
--   Se excluyen de la lista de opciones: el filtro es por número, así que
--   elegirlas no filtraría nada. Siguen saliendo con "Todas las operaciones".
--
-- PERMISOS
--   Mismo criterio que `fn_avance_area`: SUPERVISORA solo su área actual,
--   INGENIERIA cualquiera.

create or replace function public.fn_sup_reclamos_of(
  p_dni text, p_token uuid, p_area text,
  p_of text default null, p_modulo text default null, p_nop int default null)
returns json
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  s operarios;
  v_tope int := 400;
  v_of text := nullif(trim(coalesce(p_of,'')), '');
  v_mod text := nullif(trim(coalesce(p_modulo,'')), '');
  v_ofs json; v_mods json; v_ops json; v_items json; v_total int := 0;
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  if s.cargo = 'SUPERVISORA' and p_area <> s.area_actual then raise exception 'NO_AUTORIZADA'; end if;

  /* Las OF salen de `reclamos`, no de `tickets_cache`: ACABADO no pasa por el
     almacén y con tickets_cache su lista saldría vacía. Además así solo se
     ofrecen OF que de verdad tienen algo reclamado. Se comparan por el texto
     crudo para que entre por reclamos_of_activo (o_f, area). */
  select coalesce(json_agg(json_build_object(
           'of', z.o_f, 'articulo', z.articulo, 'n', z.n) order by z.o_f desc), '[]'::json)
    into v_ofs
    from (select r.o_f, max(r.articulo) articulo, count(*) n
            from reclamos r
           where r.area = p_area and r.estado = 'ACTIVO' and coalesce(r.o_f,'') <> ''
           group by r.o_f) z;

  /* Sin OF no se devuelve NADA de detalle: es la regla de la pantalla. */
  if v_of is null then
    return json_build_object('ok', true, 'es_acabado', (p_area = 'ACABADO'),
      'ofs', v_ofs, 'modulos', '[]'::json, 'operaciones', '[]'::json,
      'items', '[]'::json, 'total', 0, 'tope', v_tope);
  end if;

  select coalesce(json_agg(json_build_object('modulo', z.m, 'n', z.n) order by z.m), '[]'::json)
    into v_mods
    from (select coalesce(nullif(trim(r.modulo),''), '') m, count(*) n
            from reclamos r
           where r.area = p_area and r.estado = 'ACTIVO' and r.o_f = v_of
           group by 1) z;

  /* Las operaciones ya se acotan al módulo elegido: el filtro va limitando. */
  select coalesce(json_agg(json_build_object(
           'nop', z.nop, 'operacion', z.op, 'n', z.n) order by z.nop, z.op), '[]'::json)
    into v_ops
    from (select r.nop, max(r.op) op, count(*) n
            from reclamos r
           where r.area = p_area and r.estado = 'ACTIVO' and r.o_f = v_of
             and r.nop is not null
             and (v_mod is null or coalesce(nullif(trim(r.modulo),''), '') = v_mod)
           group by r.nop) z;

  select count(*) into v_total
    from reclamos r
   where r.area = p_area and r.estado = 'ACTIVO' and r.o_f = v_of
     and (v_mod is null or coalesce(nullif(trim(r.modulo),''), '') = v_mod)
     and (p_nop is null or r.nop = p_nop);

  /* Tope de filas: una OF de costura llega a 2.000 reclamos y esto se ve en el
     celular. El total va aparte para poder decir "mostrando X de Y". */
  select coalesce(json_agg(json_build_object(
           'dni', z.dni, 'nombre', z.nombre,
           'numeracion', z.numeracion, 'cant', round(z.cant, 0),
           'modulo', z.modulo, 'operacion', z.op, 'nop', z.nop,
           'fecha', to_char(z.creado at time zone 'America/Lima', 'YYYY-MM-DD'),
           'hora',  to_char(z.creado at time zone 'America/Lima', 'HH24:MI'))
           order by z.creado desc), '[]'::json)
    into v_items
    from (select r.dni, o.nombres_apellidos nombre, r.numeracion, r.cant,
                 coalesce(nullif(trim(r.modulo),''), '') modulo, r.op, r.nop, r.creado
            from reclamos r
            left join operarios o on o.dni = r.dni
           where r.area = p_area and r.estado = 'ACTIVO' and r.o_f = v_of
             and (v_mod is null or coalesce(nullif(trim(r.modulo),''), '') = v_mod)
             and (p_nop is null or r.nop = p_nop)
           order by r.creado desc
           limit v_tope) z;

  return json_build_object('ok', true, 'es_acabado', (p_area = 'ACABADO'),
    'ofs', v_ofs, 'modulos', v_mods, 'operaciones', v_ops,
    'items', v_items, 'total', v_total, 'tope', v_tope);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

notify pgrst, 'reload schema';
