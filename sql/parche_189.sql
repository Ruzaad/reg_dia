-- Parche 189 — Tomar tiempos: el catálogo trae siempre las operaciones vigentes de la BASE
-- Antes: 615 operaciones de la BASE no tenían su fila en la base madre (tiempos_operaciones) y
-- no salían en el aplicativo. Ahora el catálogo las siembra al pedirse y el trigger también
-- cubre el cambio de nombre de una operación.
begin;

create or replace function public.fn_tiempos_catalogo(p_dni text, p_token uuid, p_area text)
returns json language plpgsql security definer set search_path to 'public' set statement_timeout to '30s'
as $function$
declare o operarios; v_art json; v_ops json; v_per json; v_mad json;
begin
  o := _tmp_analista(p_dni, p_token, p_area);
  perform _tmp_sembrar(p_area, 'CATALOGO');   -- operaciones nuevas o renombradas de la BASE entran antes de armar el catálogo

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

create or replace function public._tmp_bases_trg()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if _tmp_clave(new.operacion) <> '' then
    insert into tiempos_operaciones (area, clave, nombre, creado_por)
    values (new.area, _tmp_clave(new.operacion), new.operacion,
            coalesce(nullif(current_setting('app.dni', true), ''), 'SISTEMA'))
    on conflict (area, clave) do nothing;
  end if;
  return null;
end $function$;
drop trigger if exists tiempos_bases_upd_trg on public.bases;
create trigger tiempos_bases_upd_trg after update of operacion on public.bases
  for each row when (old.operacion is distinct from new.operacion)
  execute function public._tmp_bases_trg();

-- Ponerse al día ahora (agrega las que faltan, no toca las existentes)
select public._tmp_sembrar(null, 'PARCHE_189');

select (select count(*) from bases b left join tiempos_operaciones t
          on t.area = b.area and t.clave = _tmp_clave(b.operacion) where t.id is null) as bases_sin_madre;
commit;
