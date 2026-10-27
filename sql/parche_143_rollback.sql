-- Deshacer parche 143: vuelve a rechazar ACABADO en Adicionales por OF.
begin;

create or replace function public.fn_opad_guardar(
  p_dni text, p_token uuid, p_id bigint, p_area text, p_of text, p_modulo text,
  p_operacion text, p_std numeric, p_tope numeric, p_motivo text,
  p_area_origen text, p_activa boolean)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s operarios; a ops_adicionales_of; v_of text; v_art text; v_mod text; v_op text;
        v_mot text; v_ori text; v_hecho numeric; v_nop int; v_id bigint;
begin
  s := _ing(p_dni, p_token);
  v_mot := nullif(upper(trim(coalesce(p_motivo,''))), '');
  v_ori := nullif(upper(trim(coalesce(p_area_origen,''))), '');
  if coalesce(p_std,0) <= 0 then
    return json_build_object('ok',false,'error','El STD debe ser mayor que cero'); end if;
  if p_tope is not null and p_tope <= 0 then
    return json_build_object('ok',false,'error','La cantidad autorizada debe ser mayor que cero, o déjala vacía'); end if;
  if v_mot is null then
    return json_build_object('ok',false,'error','Escribe el motivo'); end if;

  if p_id is not null then
    select * into a from ops_adicionales_of where id = p_id for update;
    if not found then return json_build_object('ok',false,'error','No existe esa operación'); end if;
    select coalesce(sum(cant),0) into v_hecho from reclamos
     where op_adicional_id = a.id and estado = 'ACTIVO';
    if p_tope is not null and p_tope < v_hecho then
      return json_build_object('ok',false,'error',
        'Ya se registraron '||round(v_hecho,0)||' und: la cantidad autorizada no puede ser menor'); end if;
    update ops_adicionales_of
       set std = p_std, tope = p_tope, motivo = v_mot, area_origen = v_ori,
           activa = coalesce(p_activa, activa)
     where id = a.id;
    if p_std <> a.std then
      update reclamos
         set std = case when causa is null then p_std
                        else p_std + coalesce((select c.delta from causas_std c
                                                where c.texto = reclamos.causa), 0) end,
             std_base = case when causa is null then null else p_std end
       where op_adicional_id = a.id;
    end if;
    return json_build_object('ok', true, 'id', a.id);
  end if;

  if coalesce(trim(p_area),'') = '' then
    return json_build_object('ok',false,'error','Elige el área'); end if;
  if p_area = 'ACABADO' then
    return json_build_object('ok',false,'error','En ACABADO usa Operaciones sin OF'); end if;
  select f.o_f, f.articulo into v_of, v_art from ofs f where _nk(f.o_f) = _nk(p_of) limit 1;
  if not found then return json_build_object('ok',false,'error','Esa OF no está registrada'); end if;
  if v_art is null then return json_build_object('ok',false,'error','La OF no tiene artículo'); end if;

  v_mod := upper(trim(coalesce(p_modulo,'')));
  v_op  := upper(trim(coalesce(p_operacion,'')));
  if v_op = '' then return json_build_object('ok',false,'error','Escribe la operación'); end if;
  if cardinality(_opad_modulos(p_area, v_art)) = 0 then
    return json_build_object('ok',false,'error','El artículo '||v_art||' no tiene BASE en '||p_area); end if;
  if not (v_mod = any(_opad_modulos(p_area, v_art))) then
    return json_build_object('ok',false,'error','Elige un módulo de la BASE del artículo'); end if;

  select b.n_op into v_nop from bases b
   where b.area = p_area and _nk(b.articulo) = _nk(v_art) and _nk(b.operacion) = _nk(v_op)
   order by b.id limit 1;
  if found then
    return json_build_object('ok',false,'error',
      'Esa operación ya está en la BASE del artículo (N°OP '||coalesce(v_nop::text,'—')||
      '): sale en sus tickets, no hace falta agregarla'); end if;

  insert into ops_adicionales_of (area, o_f, articulo, modulo, operacion, std, tope,
                                  motivo, area_origen, activa, creado_por)
  values (p_area, v_of, v_art, v_mod, v_op, p_std, p_tope, v_mot, v_ori,
          coalesce(p_activa, true), s.dni)
  on conflict (area, o_f, modulo, operacion) do nothing
  returning id into v_id;
  if v_id is null then
    return json_build_object('ok',false,'error','Esa operación ya está agregada a la OF en ese módulo'); end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_opad_guardar(text, uuid, bigint, text, text, text, text, numeric, numeric, text, text, boolean) to anon, authenticated;

commit;
