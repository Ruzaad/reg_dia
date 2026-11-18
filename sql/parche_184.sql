-- PARCHE 184 — Reconocimiento por quincena: top 5 por área con eficiencia mayor a 80 % y todas sus boletas.
-- Ingeniería calcula el top con fn_incentivos_quincena (ya existe) y lo PUBLICA; el operario lo ve en su inicio.
-- Una tabla mínima: 5 personas × 6 áreas × 2 quincenas ≈ 60 filas al mes (< 10 KB al año). No toca ninguna función existente.
-- Rollback: parche_184_rollback.sql
begin;

create table if not exists public.reconocimientos (
  desde       date not null,           -- inicio de la quincena
  hasta       date not null,           -- fin de la quincena
  dni         text not null,
  area        text not null,
  puesto      smallint not null,       -- 1 a 5 dentro de su área
  ef          numeric(5,1) not null,   -- eficiencia promedio de la quincena (la de Bonificaciones)
  categoria   text,                    -- categoría que tenía al publicar
  publicado   timestamptz not null default now(),
  publicado_por text,
  primary key (desde, dni)
);
alter table public.reconocimientos enable row level security;
revoke all on public.reconocimientos from anon, authenticated;

-- Publicar (reemplaza lo publicado de esa quincena). Pestaña Incentivos.
create or replace function public.fn_reconocimiento_publicar(
  p_dni text, p_token uuid, p_desde date, p_hasta date, p_items json)
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '10s'
as $function$
declare o operarios; n int;
begin
  o := _vista(p_dni, p_token, array['pasoInc'], '');
  if p_hasta < p_desde or (p_hasta - p_desde) > 20 then
    return json_build_object('ok', false, 'error', 'Quincena inválida'); end if;
  if json_array_length(coalesce(p_items, '[]'::json)) > 80 then
    return json_build_object('ok', false, 'error', 'Demasiados reconocidos'); end if;
  delete from reconocimientos where desde = p_desde;
  insert into reconocimientos (desde, hasta, dni, area, puesto, ef, categoria, publicado_por)
  select p_desde, p_hasta, x->>'dni', x->>'area', (x->>'puesto')::smallint, (x->>'ef')::numeric,
         nullif(x->>'categoria', ''), o.dni
    from json_array_elements(coalesce(p_items, '[]'::json)) x
   where coalesce(x->>'dni', '') <> '' and (x->>'puesto')::int between 1 and 5;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'publicados', n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_reconocimiento_publicar(text, uuid, date, date, json) from public;
grant execute on function public.fn_reconocimiento_publicar(text, uuid, date, date, json) to anon, authenticated;

-- Lo publicado de una quincena (para que Ingeniería vea si ya está publicada).
create or replace function public.fn_reconocimientos(p_dni text, p_token uuid, p_desde date)
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '10s'
as $function$
begin
  perform _vista(p_dni, p_token, array['pasoInc'], '');
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object('dni', dni, 'area', area, 'puesto', puesto, 'ef', ef, 'categoria', categoria,
                                      'publicado', to_char(publicado at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'))
                    order by area, puesto)
      from reconocimientos where desde = p_desde), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_reconocimientos(text, uuid, date) from public;
grant execute on function public.fn_reconocimientos(text, uuid, date) to anon, authenticated;

-- Lo del propio operario: sus últimas 6 quincenas reconocidas.
create or replace function public.fn_mi_reconocimiento(p_dni text, p_token uuid)
 returns json language plpgsql security definer
 set search_path to 'public' set statement_timeout to '5s'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object('desde', to_char(desde, 'YYYY-MM-DD'), 'hasta', to_char(hasta, 'YYYY-MM-DD'),
                                      'area', area, 'puesto', puesto, 'ef', ef, 'categoria', categoria) order by desde desc)
      from (select * from reconocimientos where dni = o.dni order by desde desc limit 6) z), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.fn_mi_reconocimiento(text, uuid) from public;
grant execute on function public.fn_mi_reconocimiento(text, uuid) to anon, authenticated;

commit;
