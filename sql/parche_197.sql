-- Parche 197: corrige fn_bases_agregar_varios (el UPDATE sin WHERE lo bloquea la base).
begin;

create or replace function public.fn_bases_agregar_varios(p_dni text, p_token uuid, p_area text, p_filas jsonb)
returns json language plpgsql security definer set search_path to 'public'
set statement_timeout to '30s' as $$
declare o operarios; v_dup jsonb; v_inv jsonb; v_ok jsonb; v_filas int := 0; v_art text;
begin
  o := _ing(p_dni, p_token);
  if coalesce(trim(p_area), '') = '' then return json_build_object('ok', false, 'error', 'Elige el área'); end if;
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    return json_build_object('ok', false, 'error', 'No hay filas para registrar');
  end if;
  if jsonb_array_length(p_filas) > 5000 then
    return json_build_object('ok', false, 'error', 'Máximo 5000 filas por carga');
  end if;

  drop table if exists _bv;
  create temp table _bv on commit drop as
  select t.n::int n, upper(trim(coalesce(x->>'articulo',''))) articulo, _nk(x->>'articulo') ka,
         trim(coalesce(x->>'operacion','')) operacion, _nk(x->>'operacion') ko,
         upper(trim(coalesce(x->>'prenda',''))) prenda, upper(trim(coalesce(x->>'cliente',''))) cliente,
         trim(coalesce(x->>'modulo','')) modulo,
         trim(coalesce(x->>'std','0')) std_t, trim(coalesce(x->>'n_op','')) nop_t, null::text motivo
    from jsonb_array_elements(p_filas) with ordinality t(x, n);

  update _bv set motivo = case
      when articulo = '' then 'Sin artículo'
      when operacion = '' then 'Sin operación'
      when std_t !~ '^[0-9]{1,4}([.][0-9]{1,3})?$' then 'STD inválido'
      when nop_t <> '' and nop_t !~ '^[1-9][0-9]{0,2}$' then 'N°OP inválido' end
   where true;
  update _bv b set motivo = 'Operación repetida'
   where b.motivo is null and exists (select 1 from _bv z where z.ka = b.ka and z.ko = b.ko and z.n <> b.n);
  update _bv b set motivo = 'N°OP repetido'
   where b.motivo is null and b.nop_t <> '' and exists (select 1 from _bv z where z.ka = b.ka and z.nop_t = b.nop_t and z.n <> b.n);
  update _bv b set motivo = 'N°OP incompleto'
   where b.motivo is null and exists (select 1 from _bv z where z.ka = b.ka and (z.nop_t = '') <> (b.nop_t = ''));

  select coalesce(jsonb_agg(distinct b.articulo), '[]') into v_dup from _bv b
   where b.articulo <> '' and exists (select 1 from bases x where x.area = p_area and _nk(x.articulo) = b.ka);

  select coalesce(jsonb_agg(jsonb_build_object('articulo', a, 'motivo', m)), '[]') into v_inv from (
    select coalesce(nullif(min(articulo), ''), '(sin código)') a, min(motivo) m
      from _bv b
     where not exists (select 1 from bases x where x.area = p_area and _nk(x.articulo) = b.ka and b.ka <> '')
     group by ka having bool_or(motivo is not null)) z;

  select coalesce(jsonb_agg(articulo), '[]') into v_ok from (
    select min(articulo) articulo from _bv b
     where ka <> ''
       and not exists (select 1 from bases x where x.area = p_area and _nk(x.articulo) = b.ka)
     group by ka having not bool_or(motivo is not null)) z;

  insert into bases (area, prenda, cliente, modulo, articulo, operacion, std, max_op, n_op, subido_por)
  select p_area, nullif(prenda, ''), nullif(cliente, ''), nullif(modulo, ''), articulo, operacion, std_t::numeric,
         count(*) over (partition by ka),
         coalesce(nullif(nop_t, '')::int, (row_number() over (partition by ka order by n))::int),
         o.dni
    from _bv b
   where ka <> '' and (v_ok ? articulo);
  get diagnostics v_filas = row_count;

  for v_art in select jsonb_array_elements_text(v_ok) loop
    perform fn_tickets_cache_refrescar_articulo(p_area, v_art);
  end loop;

  return json_build_object('ok', true, 'creados', v_ok, 'filas', v_filas, 'duplicados', v_dup, 'invalidos', v_inv);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;
grant execute on function public.fn_bases_agregar_varios(text, uuid, text, jsonb) to anon, authenticated;

commit;
