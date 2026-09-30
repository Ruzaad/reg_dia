-- PARCHE 89 — Ingeniería · REEMPLAZAR EL DESGLOSE DE UNA OF CON SU HN
-- Hasta ahora, una HN subida con un error (una fila de menos, la cantidad mal
-- tipeada, otra prenda) quedaba así para siempre: fn_of_registrar solo avisa
-- de las diferencias y no vuelve a escribir. Esta función reescribe el
-- desglose de la OF con la HN corregida, siempre que NO haya tickets
-- reclamados de esa OF en ninguna área (los códigos de ticket salen del N° de
-- paquete, así que cambiar el desglose con reclamos vivos los descuadraría).
--
-- · Si la OF tiene una sola prenda (o ninguna), se reemplaza todo: artículo,
--   prenda, corte y paquetes.
-- · Si tiene dos (terno), solo se reemplaza la prenda indicada; el corte de
--   la OF no se toca.
-- Las áreas donde ya se generó se refrescan en el caché de tickets.
-- fn_of_registrar no cambia.

create or replace function public.fn_of_reemplazar(
  p_dni text, p_token uuid, p_of text, p_articulo text, p_prenda text,
  p_cant_prog numeric, p_detalle jsonb)
 returns json language plpgsql security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare s operarios; e ofs; v_of text; v_pre text; npre integer; n integer;
        v_area text;
begin
  s := _auth(p_dni, p_token);
  if s.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  v_of := upper(trim(coalesce(p_of,'')));
  v_pre := upper(trim(coalesce(p_prenda,'')));
  if v_of = '' then return json_build_object('ok',false,'error','OF vacia'); end if;
  if coalesce(p_cant_prog,0) <= 0 then
    return json_build_object('ok',false,'error','Cantidad programada invalida'); end if;
  if coalesce(jsonb_array_length(p_detalle),0) = 0 then
    return json_build_object('ok',false,'error','La HN no trae paquetes'); end if;

  select * into e from ofs where o_f = v_of for update;
  if not found then
    return json_build_object('ok',false,'error','La OF no esta registrada'); end if;

  if exists(select 1 from reclamos r where r.o_f = v_of and r.estado = 'ACTIVO') then
    return json_build_object('ok',false,'error',
      'La OF ya tiene tickets reclamados: no se puede reemplazar su desglose'); end if;

  select count(distinct prenda) into npre from of_detalle where o_f = v_of;

  if npre <= 1 then
    delete from of_detalle where o_f = v_of;
    update ofs set articulo = upper(trim(coalesce(p_articulo, e.articulo))),
                   prenda = nullif(v_pre,''), cant_prog = p_cant_prog
     where o_f = v_of;
  else
    if not exists(select 1 from of_detalle where o_f = v_of and prenda = v_pre) then
      return json_build_object('ok',false,'error',
        'La OF tiene dos prendas y ninguna es '||coalesce(nullif(v_pre,''),'(vacia)')); end if;
    delete from of_detalle where o_f = v_of and prenda = v_pre;
  end if;

  insert into of_detalle(o_f, prenda, paq, talla, color, cant, desde, hasta)
  select v_of, v_pre, (x->>'paq')::int, nullif(trim(x->>'talla'),''),
         nullif(upper(trim(coalesce(x->>'color',''))),''),
         (x->>'cant')::numeric, (x->>'desde')::int, (x->>'hasta')::int
  from jsonb_array_elements(p_detalle) x
  where coalesce((x->>'cant')::numeric,0) > 0;
  get diagnostics n = row_count;

  for v_area in select area from of_generada where o_f = v_of loop
    perform fn_tickets_cache_refrescar(v_area, v_of);
  end loop;

  return json_build_object('ok',true,'of',v_of,'prenda',v_pre,'paquetes',n,
    'cant_prog',p_cant_prog,'solo_prenda',npre > 1);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_of_reemplazar(text, uuid, text, text, text, numeric, jsonb) from public;
grant execute on function public.fn_of_reemplazar(text, uuid, text, text, text, numeric, jsonb) to anon, authenticated;
