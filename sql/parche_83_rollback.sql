-- Vuelta atrás del PARCHE 83. Deja _paq_div_n como estaba en producción antes
-- del parche (definición sacada de la base el 23-set-2026) y vacía las dos
-- columnas en las OF generadas, que es como estaban.

drop trigger if exists of_troceo_ofs_div on public.of_troceo;
drop trigger if exists of_generada_ofs_div on public.of_generada;
drop function if exists public._tg_ofs_div_sync();
drop function if exists public._ofs_div_sync(text);
drop view if exists public.v_ofs_troceo;

create or replace function public._paq_div_n(p_area text, p_of text, p_nop integer)
 returns integer language plpgsql stable security definer set search_path to 'public'
as $function$
declare f ofs; nu integer; np integer; v integer; v_op bigint;
begin
  if p_nop is null then return null; end if;
  select * into f from ofs where _nk(o_f) = _nk(p_of);
  if found then
    select b.op_id into v_op from bases b
     where b.area = p_area and _nk(b.articulo) = _nk(f.articulo) and b.n_op = p_nop
     order by b.id limit 1;
    if v_op is not null then
      select t.n into v from of_troceo t
       where t.area = p_area and _nk(t.o_f) = _nk(p_of) and t.op_id = v_op;
      if v is not null then return v; end if;          -- OF generada en el sistema
    end if;
  else
    return null;
  end if;
  select max(n_op) into nu from bases
   where area = p_area and _nk(articulo) = _nk(f.articulo) and coalesce(n_op,0) > 0;
  if nu is null then return null; end if;
  select max(n_op) into np from bases
   where area = p_area and _nk(articulo) = _nk(f.articulo) and coalesce(n_op,0) > 0 and n_op < nu;
  return nullif(case when p_nop = nu then f.div_ultima_n
                     when p_nop = np then f.div_penultima_n end, 0);
end $function$;

update public.ofs set div_ultima_n = null, div_penultima_n = null
 where o_f in (select o_f from public.of_generada);
