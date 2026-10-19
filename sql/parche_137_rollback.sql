-- Deshace el parche 137: _auth vuelve a devolver el cargo real también en sesiones prestadas SUP.
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
