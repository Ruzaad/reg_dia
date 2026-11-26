-- Deshacer parche 189: vuelve el catálogo del parche 104 (las filas sembradas se dejan, son inofensivas)
begin;
create or replace function public.fn_tiempos_catalogo(p_dni text, p_token uuid, p_area text)
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare o operarios; v_art json; v_ops json; v_per json; v_mad json;
begin
  o := _tmp_analista(p_dni, p_token, p_area);

  select coalesce(json_agg(json_build_object('articulo', t.articulo, 'prenda', t.prenda,
           'cliente', t.cliente) order by t.articulo), '[]'::json) into v_art
    from (select distinct b.articulo, b.prenda, b.cliente
            from bases b where b.area = p_area and coalesce(b.articulo,'') <> '') t;

  select coalesce(json_agg(json_build_object(
           'articulo', b.articulo, 'n_op', b.n_op, 'modulo', b.modulo,
           'operacion', b.operacion, 'std', b.std, 'op_id', m.id,
           'postura', m.postura, 'nivel', s.nivel, 'te_medido', s.te_min)
           order by b.articulo, b.n_op), '[]'::json) into v_ops
    from bases b
    join tiempos_operaciones m on m.area = b.area and m.clave = _tmp_clave(b.operacion)
    left join tiempos_estandar s on s.op_id = m.id and s.metodo = 'CRONOMETRO'
   where b.area = p_area;

  -- Operaciones del área que no cuelgan de ningún artículo vivo: se puede
  -- medir igual (Ruzaad pidió medir sin que exista la BASE del artículo).
  select coalesce(json_agg(json_build_object('op_id', m.id, 'operacion', m.nombre,
           'postura', m.postura) order by m.nombre), '[]'::json) into v_mad
    from tiempos_operaciones m where m.area = p_area and m.activa;

  select coalesce(json_agg(json_build_object('dni', p.dni, 'nombre', p.nombres_apellidos)
           order by p.nombres_apellidos), '[]'::json) into v_per
    from operarios p
   where p.estado = 'ACTIVO' and p.cargo in ('OPERARIO','ESTAJERO')
     and coalesce(p.area_actual, p.area_origen) = p_area;

  return json_build_object('ok', true, 'analista', o.dni, 'area', p_area,
    'articulos', v_art, 'operaciones', v_ops, 'madre', v_mad, 'personal', v_per);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_tiempos_catalogo(text, uuid, text) from public;
grant execute on function public.fn_tiempos_catalogo(text, uuid, text) to anon, authenticated;
drop trigger if exists tiempos_bases_upd_trg on public.bases;
commit;
