-- PARCHE 94 — Ingeniería · REEMPLAZAR LA HN AUNQUE LA OF YA TENGA RECLAMOS
-- Hasta el parche 89, fn_of_reemplazar se negaba en cuanto la OF tenía un solo
-- ticket reclamado (ACTIVO), y una HN con error quedaba sin arreglo.
--
-- Los reclamos guardan su propia copia (cantidad, talla, numeración), así que
-- reescribir of_detalle no los toca ni cambia lo ya ganado. Ahora:
-- · Si ningún paquete con reclamos cambia (mismo N°, talla y cantidad), se
--   reemplaza directo.
-- · Si alguno cambia o desaparece, la función devuelve confirmar=true con la
--   lista de esos paquetes; la pantalla lo muestra y, si se acepta, vuelve a
--   llamar con p_forzar=true. Esos reclamos quedan con sus datos de antes.
-- El parámetro p_forzar tiene default false: los despliegues sin migrar que
-- llaman con 7 parámetros siguen funcionando (sin forzar).

drop function if exists public.fn_of_reemplazar(text, uuid, text, text, text, numeric, jsonb);

create or replace function public.fn_of_reemplazar(
  p_dni text, p_token uuid, p_of text, p_articulo text, p_prenda text,
  p_cant_prog numeric, p_detalle jsonb, p_forzar boolean default false)
 returns json language plpgsql security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare s operarios; e ofs; v_of text; v_pre text; npre integer; n integer;
        v_area text; v_afect jsonb; v_nrec integer;
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

  select count(distinct prenda) into npre from of_detalle where o_f = v_of;
  if npre > 1 and not exists(select 1 from of_detalle where o_f = v_of and prenda = v_pre) then
    return json_build_object('ok',false,'error',
      'La OF tiene dos prendas y ninguna es '||coalesce(nullif(v_pre,''),'(vacia)')); end if;

  -- Paquetes con reclamos ACTIVO que la nueva HN cambia o quita.
  -- El código del ticket es paq || OF || '1' || op_id.
  with rec as (
    select nullif(left(r.codigo, strpos(r.codigo, r.o_f) - 1), '')::int paq, count(*) n
      from reclamos r
     where r.o_f = v_of and r.estado = 'ACTIVO' and strpos(r.codigo, r.o_f) > 1
       and left(r.codigo, strpos(r.codigo, r.o_f) - 1) ~ '^[0-9]+$'
     group by 1),
  viejo as (
    select d.paq, d.talla, d.cant from of_detalle d
     where d.o_f = v_of and (npre <= 1 or d.prenda = v_pre)),
  nuevo as (
    select (x->>'paq')::int paq, nullif(trim(x->>'talla'),'') talla, (x->>'cant')::numeric cant
      from jsonb_array_elements(p_detalle) x
     where coalesce((x->>'cant')::numeric,0) > 0)
  select coalesce(jsonb_agg(jsonb_build_object('paq', rec.paq, 'tickets', rec.n,
           'antes', coalesce(v.talla,'')||' · '||coalesce(v.cant::text,''),
           'ahora', case when nw.paq is null then 'ya no esta'
                         else coalesce(nw.talla,'')||' · '||nw.cant::text end)
           order by rec.paq), '[]'::jsonb),
         coalesce(sum(rec.n),0)
    into v_afect, v_nrec
    from rec
    join viejo v on v.paq = rec.paq
    left join nuevo nw on nw.paq = rec.paq
   where nw.paq is null or nw.cant is distinct from v.cant
      or coalesce(nw.talla,'') is distinct from coalesce(v.talla,'');

  if jsonb_array_length(v_afect) > 0 and not coalesce(p_forzar,false) then
    return json_build_object('ok',false,'confirmar',true,'of',v_of,
      'paquetes_reclamados',v_afect,'tickets',v_nrec,
      'error','La OF tiene tickets reclamados en paquetes que cambian');
  end if;

  if npre <= 1 then
    delete from of_detalle where o_f = v_of;
    update ofs set articulo = upper(trim(coalesce(p_articulo, e.articulo))),
                   prenda = nullif(v_pre,''), cant_prog = p_cant_prog
     where o_f = v_of;
  else
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
    'cant_prog',p_cant_prog,'solo_prenda',npre > 1,
    'paquetes_reclamados',v_afect);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

revoke all on function public.fn_of_reemplazar(text, uuid, text, text, text, numeric, jsonb, boolean) from public;
grant execute on function public.fn_of_reemplazar(text, uuid, text, text, text, numeric, jsonb, boolean) to anon, authenticated;
