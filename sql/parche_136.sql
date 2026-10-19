-- PARCHE 136 — Reclasificar rápido (REPROCESO): una falla con varias tallas en un solo guardado
-- Antes: color, talla, falla y cantidad escritos a mano, una fila por guardada (parche 128).
-- Ahora: la pantalla elige color y falla con botones y la cantidad por talla; todo lo de una
-- falla se guarda junto (una "tanda") y se puede anular junto.
-- Las RPC del parche 128 se quedan (las usan los despliegues sin migrar).
-- Rollback: parche_136_rollback.sql
begin;

alter table public.reproceso_reclasif add column if not exists tanda uuid;
create index if not exists reproceso_reclasif_tanda on public.reproceso_reclasif (tanda) where tanda is not null;

-- Lo de la pantalla en una sola llamada: lo que ya devolvía el parche 128 más tallas de la
-- prenda, colores, el cuadro falla × talla y las tandas guardadas.
create or replace function public.fn_reproceso_reclasif_info2(p_dni text, p_token uuid, p_of text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; f ofs; r jsonb;
begin
  o := _auth(p_dni, p_token);
  if not _reclasif_permiso(o) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a la reclasificación de REPROCESO'; end if;
  r := fn_reproceso_reclasif_info(p_dni, p_token, p_of)::jsonb;
  if not coalesce((r->>'ok')::boolean, false) then return r::json; end if;
  select * into f from ofs where _nk(o_f) = _nk(p_of) and reproceso;
  return (r || jsonb_build_object(
    'tallas', coalesce((
      select jsonb_agg(t.talla order by case when t.talla ~ '^[0-9]+$' then 0 else 1 end,
                       case when t.talla ~ '^[0-9]+$' then t.talla::int end,
                       array_position(array['XXS','XS','S','M','L','XL','XXL','XXXL'], t.talla), t.talla)
        from (select talla from (select d.talla, count(*) n from of_detalle d
                                  where d.prenda = f.prenda and coalesce(d.talla,'') <> ''
                                  group by d.talla order by count(*) desc, d.talla limit 12) a
              union
              select talla from reproceso_reclasif where o_f = f.o_f and estado = 'ACTIVO') t), '[]'::jsonb),
    'colores2', coalesce((
      select jsonb_agg(c.x) from (
        select x from (select color x, 0 g, count(*) n from reproceso_reclasif where o_f = f.o_f and estado = 'ACTIVO' group by color
                       union all
                       select d.color, 1, count(*) from of_detalle d where d.prenda = f.prenda and coalesce(d.color,'') <> '' group by d.color) u
        group by x order by min(g), sum(n) desc, x limit 10) c), '[]'::jsonb),
    'celdas', coalesce((
      select jsonb_agg(jsonb_build_object('falla', falla, 'talla', talla, 'cant', c))
        from (select falla, talla, sum(cantidad) c from reproceso_reclasif
               where o_f = f.o_f and estado = 'ACTIVO' group by falla, talla) z), '[]'::jsonb),
    'tandas', coalesce((
      select jsonb_agg(jsonb_build_object('k', t.k, 'falla', t.falla, 'color', t.color, 'cant', t.cant, 'creado', t.ult,
                                           'por', coalesce(p.nombres_apellidos, t.dni), 'tallas', t.tallas) order by t.ult desc)
        from (select coalesce(tanda::text, 'f' || min(id)) k, falla, color, sum(cantidad) cant, max(creado) ult, min(dni) dni,
                     jsonb_agg(jsonb_build_object('talla', talla, 'cant', cantidad) order by talla) tallas
                from reproceso_reclasif where o_f = f.o_f and estado = 'ACTIVO'
               group by coalesce(tanda::text, 'f' || id), tanda, falla, color order by max(creado) desc limit 30) t
        left join operarios p on p.dni = t.dni), '[]'::jsonb)
  ))::json;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_reclasif_info2(text, uuid, text) to anon, authenticated;

-- Guarda una falla con sus tallas: p_tallas = [{"talla":"30","cant":6}, ...]. Todo o nada.
create or replace function public.fn_reproceso_reclasificar_varias(p_dni text, p_token uuid, p_of text, p_color text, p_falla text, p_tallas jsonb)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; f ofs; v_n2 int; v_hecho numeric; v_rec numeric; v_tot int; v_arr jsonb; v_tanda uuid := gen_random_uuid();
        v_color text := upper(trim(coalesce(p_color, '')));
        v_falla text := upper(trim(coalesce(p_falla, '')));
begin
  o := _auth(p_dni, p_token);
  if not _reclasif_permiso(o) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a la reclasificación de REPROCESO'; end if;
  if v_color = '' or v_falla = '' then return json_build_object('ok', false, 'error', 'Elige el color y el tipo de falla'); end if;
  if length(v_color) > 40 or length(v_falla) > 60 then return json_build_object('ok', false, 'error', 'Texto demasiado largo'); end if;
  if jsonb_typeof(coalesce(p_tallas, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_tallas) = 0 or jsonb_array_length(p_tallas) > 40 then
    return json_build_object('ok', false, 'error', 'Pon la cantidad en al menos una talla'); end if;
  select jsonb_agg(jsonb_build_object('talla', z.t, 'cant', z.c)), coalesce(sum(z.c), 0) into v_arr, v_tot
    from (select upper(trim(x->>'talla')) t, sum(coalesce((x->>'cant')::int, 0)) c
            from jsonb_array_elements(p_tallas) x group by 1) z;
  if exists (select 1 from jsonb_array_elements(v_arr) y
              where (y->>'talla') = '' or length(y->>'talla') > 20 or (y->>'cant')::int <= 0 or (y->>'cant')::int > 1000000) then
    return json_build_object('ok', false, 'error', 'Revisa las tallas y cantidades'); end if;
  select * into f from ofs where _nk(o_f) = _nk(p_of) and reproceso;
  if not found then return json_build_object('ok', false, 'error', 'Ese lote no es de REPROCESO'); end if;
  select u.n2 into v_n2 from _ultimas('REPROCESO') u where u.k = _nk(f.articulo);
  if v_n2 is null then
    return json_build_object('ok', false, 'error', 'La base de ' || f.articulo || ' no tiene penúltima operación'); end if;
  perform pg_advisory_xact_lock(hashtext('reproceso_reclasif:' || f.o_f));
  select coalesce(sum(cant), 0) into v_hecho from reclamos
   where area = 'REPROCESO' and estado = 'ACTIVO' and _nk(o_f) = _nk(f.o_f) and nop = v_n2;
  select coalesce(sum(cantidad), 0) into v_rec from reproceso_reclasif where o_f = f.o_f and estado = 'ACTIVO';
  if v_rec + v_tot > v_hecho then
    return json_build_object('ok', false, 'error', 'Solo hay ' || round(v_hecho - v_rec, 0) ||
      ' prendas por reclasificar y quieres guardar ' || v_tot); end if;
  insert into reproceso_reclasif (o_f, articulo, n_op, color, talla, falla, cantidad, dni, tanda)
    select f.o_f, f.articulo, v_n2, v_color, y.talla, v_falla, y.cant, o.dni, v_tanda
      from jsonb_to_recordset(v_arr) as y(talla text, cant int);
  return json_build_object('ok', true, 'tanda', v_tanda, 'guardadas', v_tot, 'queda', v_hecho - v_rec - v_tot);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_reclasificar_varias(text, uuid, text, text, text, jsonb) to anon, authenticated;

-- Anula una tanda completa (o una fila vieja del parche 128, cuya clave es "f" + id).
create or replace function public.fn_reproceso_reclasif_anular_tanda(p_dni text, p_token uuid, p_k text)
 returns json language plpgsql security definer set search_path to 'public' as $function$
declare o operarios; v_n int; v_tanda uuid;
begin
  o := _auth(p_dni, p_token);
  if not _reclasif_permiso(o) then raise exception 'NO_AUTORIZADA_AREA: sin acceso a la reclasificación de REPROCESO'; end if;
  if p_k ~ '^f[0-9]+$' then
    if not _lote_permiso(o, 'REPROCESO', true) and exists (select 1 from reproceso_reclasif where id = substr(p_k, 2)::bigint and dni <> o.dni) then
      raise exception 'NO_AUTORIZADA: solo quien la anotó puede anularla'; end if;
    update reproceso_reclasif set estado = 'ANULADO', anulado_por = o.dni, anulado = now()
     where id = substr(p_k, 2)::bigint and estado = 'ACTIVO' and tanda is null;
  else
    v_tanda := p_k::uuid;
    if not _lote_permiso(o, 'REPROCESO', true) and exists (select 1 from reproceso_reclasif where tanda = v_tanda and dni <> o.dni) then
      raise exception 'NO_AUTORIZADA: solo quien la anotó puede anularla'; end if;
    update reproceso_reclasif set estado = 'ANULADO', anulado_por = o.dni, anulado = now()
     where tanda = v_tanda and estado = 'ACTIVO';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then return json_build_object('ok', false, 'error', 'Esa tanda ya no existe'); end if;
  return json_build_object('ok', true, 'filas', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.fn_reproceso_reclasif_anular_tanda(text, uuid, text) to anon, authenticated;

commit;
