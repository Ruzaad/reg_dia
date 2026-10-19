-- PARCHE 137 — Oficina (COSTOS, etc.) operando como supervisora de un área
-- Problema: VBENDITA (cargo COSTOS) abre "Operar como supervisora de REPROCESO" y la sesión se
-- abre, pero las RPC de supervisora validan el cargo (SUPERVISORA/INGENIERIA) y contestan
-- NO_AUTORIZADA: la pantalla queda vacía (personal, asistencia, pedidos, horas extra).
-- Cambio: en una sesión prestada de tipo SUP, _auth devuelve a la persona como SUPERVISORA del
-- área prestada (salvo INGENIERIA y administradores, que se quedan como están). Los permisos de
-- escritura (_perm_set) se calculan con su cargo real, así que solo escribe en las áreas donde
-- tiene EDITAR.
-- Rollback: parche_137_rollback.sql
begin;

create or replace function public._auth(p_dni text, p_token uuid)
 returns operarios
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  o operarios;
  sp sesiones_prestadas;
  v_idle  interval := interval '4 hours';
  v_max   interval := interval '18 hours';
  v_nuevo timestamptz;
begin
  select * into o from operarios
   where dni = p_dni and token = p_token
     and token_expira > now() and estado = 'ACTIVO';
  if not found then
    -- Sesión prestada (parche 109): token propio, no toca el del operario.
    select * into sp from sesiones_prestadas
     where token = p_token and como_dni = p_dni and fin is null
       and ultimo_uso > now() - interval '60 minutes' and inicio > now() - interval '8 hours';
    if sp.id is null then raise exception 'SESION_INVALIDA'; end if;
    -- Quien la abrió debe seguir activo.
    if not exists (select 1 from operarios where dni = sp.ing_dni and estado = 'ACTIVO') then raise exception 'SESION_INVALIDA'; end if;
    select * into o from operarios where dni = p_dni and estado = 'ACTIVO';
    if not found then raise exception 'SESION_INVALIDA'; end if;
    if not fn_horario_ok() then raise exception 'FUERA_DE_HORARIO'; end if;
    if sp.ultimo_uso < now() - interval '1 minute' then
      update sesiones_prestadas set ultimo_uso = now() where id = sp.id;
    end if;
    perform set_config('app.prestada', sp.id::text, true);
    perform _perm_set(o);
    -- Parche 137: oficina operando como supervisora entra como SUPERVISORA de esa área.
    if sp.tipo = 'SUP' and not coalesce(o.es_admin, false) and o.cargo <> 'INGENIERIA' then
      o.cargo := 'SUPERVISORA';
      o.area_actual := sp.area;
    end if;
    return o;
  end if;

  if not fn_horario_ok() then raise exception 'FUERA_DE_HORARIO'; end if;

  v_nuevo := least(now() + v_idle, coalesce(o.token_creado, now()) + v_max);
  if o.token_expira < now() + (v_idle / 2) and v_nuevo > o.token_expira then
    update operarios set token_expira = v_nuevo where dni = o.dni;
    o.token_expira := v_nuevo;
  end if;

  perform _perm_set(o);
  return o;
end $function$;

commit;
