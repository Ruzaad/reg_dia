-- PARCHE 76 — Qué datos ve el personal de COSTURA en sus tickets
-- Solo COSTURA. ACABADO se queda como está.
-- Numeración y Cantidad son permanentes: no están en la tabla, así que no hay
-- forma de apagarlas ni llamando la RPC a mano. El STD ya no se muestra nunca.

create table if not exists tickets_visibilidad (
  campo   text primary key,
  visible boolean not null default true,
  orden   int not null default 0,
  etiqueta text not null
);

insert into tickets_visibilidad(campo, visible, orden, etiqueta) values
  ('pph',     true,  1, 'PPH'),
  ('minutos', true,  2, 'Minutos del ticket'),
  ('talla',   true,  3, 'Talla'),
  ('nop',     true,  4, 'N° de operación'),
  ('color',   true,  5, 'Color')
on conflict (campo) do nothing;

alter table tickets_visibilidad enable row level security;
revoke all on table tickets_visibilidad from anon, authenticated;

create or replace function public.fn_tickets_visibilidad(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _auth(p_dni, p_token);
  return coalesce((select json_object_agg(campo, visible) from tickets_visibilidad), '{}'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return '{}'::json;
end $function$;

create or replace function public.fn_tickets_visibilidad_listar(p_dni text, p_token uuid)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _ing(p_dni, p_token);
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object('campo', campo, 'visible', visible, 'etiqueta', etiqueta)
           order by orden) from tickets_visibilidad), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_tickets_visibilidad_guardar(p_dni text, p_token uuid, p_campo text, p_visible boolean)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _ing(p_dni, p_token);
  update tickets_visibilidad set visible = p_visible where campo = p_campo;
  if not found then return json_build_object('ok', false, 'error', 'Ese campo no es configurable'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
