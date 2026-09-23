-- PARCHE 82 — ofs.div_ultima_n / div_penultima_n se llenan desde el troceo real
-- Desde el parche 29 el troceo se guarda en of_troceo (por OF, área y operación)
-- al generar la OF en Ingeniería. Las dos columnas de ofs solo las llenaba el
-- camino viejo (HN → ALMACÉN del Sheet), así que en las OF generadas en el
-- sistema quedaban en NULL aunque en la app salieran troceadas.
--
-- 1) _ofs_div_sync(of): copia a ofs el troceo de la ÚLTIMA y PENÚLTIMA operación
--    de la ruta del área donde se generó la OF (si la generaron en dos áreas,
--    manda la última generada; ACABADO no trocea y se ignora).
-- 2) Triggers en of_troceo y of_generada: se mantiene solo al generar/regenerar.
-- 3) _paq_div_n: en una OF generada en el sistema, of_troceo manda SIEMPRE.
--    Antes caía a ofs.div_* cuando la operación no estaba troceada en esa área
--    (o la OF no estaba generada en esa área); con las columnas en NULL eso
--    nunca pasaba, pero al llenarlas sí: sin este cambio el paso 1 cambiaría
--    los paquetes de otra área o de otra operación.
-- 4) Backfill de las OF ya generadas.
-- 5) Vista v_ofs_troceo con el troceo completo: en PANTALON y SACO casi todas
--    las OF trocean más de dos operaciones, y eso no cabe en dos columnas.

-- 1) ------------------------------------------------------------------------
create or replace function public._ofs_div_sync(p_of text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_art text; v_area text; nu int; np int; vu int; vp int;
begin
  select o.articulo into v_art from ofs o where o.o_f = p_of;
  if not found then return; end if;

  select g.area into v_area from of_generada g
   where g.o_f = p_of and _nk(g.area) <> _nk('ACABADO')
   order by g.generada desc limit 1;
  -- Sin generar en el sistema: lo que haya en ofs vino de la HN, no se toca.
  if v_area is null then return; end if;

  select max(n_op) into nu from bases
   where area = v_area and _nk(articulo) = _nk(v_art) and coalesce(n_op,0) > 0;
  select max(n_op) into np from bases
   where area = v_area and _nk(articulo) = _nk(v_art) and coalesce(n_op,0) > 0 and n_op < nu;

  -- Mismo cruce que _paq_div_n: op_id manda, n_op de respaldo.
  select t.n into vu from of_troceo t
   where t.o_f = p_of and t.area = v_area
     and (t.op_id = (select b.op_id from bases b
                      where b.area = v_area and _nk(b.articulo) = _nk(v_art) and b.n_op = nu
                      order by b.id limit 1)
          or (t.op_id is null and t.n_op = nu))
   limit 1;
  select t.n into vp from of_troceo t
   where t.o_f = p_of and t.area = v_area
     and (t.op_id = (select b.op_id from bases b
                      where b.area = v_area and _nk(b.articulo) = _nk(v_art) and b.n_op = np
                      order by b.id limit 1)
          or (t.op_id is null and t.n_op = np))
   limit 1;

  update ofs set div_ultima_n = nullif(vu,0), div_penultima_n = nullif(vp,0)
   where o_f = p_of
     and (div_ultima_n is distinct from nullif(vu,0)
       or div_penultima_n is distinct from nullif(vp,0));
end $function$;

revoke all on function public._ofs_div_sync(text) from public, anon, authenticated;

-- 2) ------------------------------------------------------------------------
create or replace function public._tg_ofs_div_sync()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op in ('INSERT','UPDATE') then perform _ofs_div_sync(new.o_f); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.o_f is distinct from new.o_f) then
    perform _ofs_div_sync(old.o_f); end if;
  return null;
end $function$;

revoke all on function public._tg_ofs_div_sync() from public, anon, authenticated;

drop trigger if exists of_troceo_ofs_div on public.of_troceo;
create trigger of_troceo_ofs_div after insert or update or delete on public.of_troceo
  for each row execute function public._tg_ofs_div_sync();

drop trigger if exists of_generada_ofs_div on public.of_generada;
create trigger of_generada_ofs_div after insert or update or delete on public.of_generada
  for each row execute function public._tg_ofs_div_sync();

-- 3) ------------------------------------------------------------------------
create or replace function public._paq_div_n(p_area text, p_of text, p_nop integer)
 returns integer language plpgsql stable security definer set search_path to 'public'
as $function$
declare f ofs; nu integer; np integer; v integer; v_op bigint;
begin
  if p_nop is null then return null; end if;
  select * into f from ofs where _nk(o_f) = _nk(p_of);
  if not found then return null; end if;

  select b.op_id into v_op from bases b
   where b.area = p_area and _nk(b.articulo) = _nk(f.articulo) and b.n_op = p_nop
   order by b.id limit 1;
  if v_op is not null then
    select t.n into v from of_troceo t
     where t.area = p_area and _nk(t.o_f) = _nk(p_of) and t.op_id = v_op;
    if v is not null then return v; end if;            -- OF generada en el sistema
  end if;
  -- parche 82: si la OF se generó en el sistema (en cualquier área), ofs.div_*
  -- es solo una copia de of_troceo de UN área. Leerla aquí repartiría ese
  -- troceo a otras operaciones u otras áreas. Solo la HN antigua cae abajo.
  if exists (select 1 from of_generada g where _nk(g.o_f) = _nk(p_of)) then
    return null; end if;

  select max(n_op) into nu from bases
   where area = p_area and _nk(articulo) = _nk(f.articulo) and coalesce(n_op,0) > 0;
  if nu is null then return null; end if;
  select max(n_op) into np from bases
   where area = p_area and _nk(articulo) = _nk(f.articulo) and coalesce(n_op,0) > 0 and n_op < nu;
  return nullif(case when p_nop = nu then f.div_ultima_n
                     when p_nop = np then f.div_penultima_n end, 0);
end $function$;

-- 4) ------------------------------------------------------------------------
select public._ofs_div_sync(o_f) from (select distinct o_f from public.of_generada) g;

-- 5) ------------------------------------------------------------------------
create or replace view public.v_ofs_troceo with (security_invoker = true) as
select g.o_f, o.articulo, o.prenda, o.cant_prog, g.area,
       g.generada, g.generada_por,
       count(t.n_op)::int as operaciones_troceadas,
       string_agg('N°' || t.n_op || ' en ' || t.n, ', ' order by t.n_op) as troceo
  from of_generada g
  join ofs o on o.o_f = g.o_f
  left join of_troceo t on t.o_f = g.o_f and t.area = g.area
 group by g.o_f, o.articulo, o.prenda, o.cant_prog, g.area, g.generada, g.generada_por;

revoke all on public.v_ofs_troceo from anon, authenticated;
