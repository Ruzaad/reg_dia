-- Rollback del PARCHE 109 (sesiones prestadas). Devuelve _auth a su versión
-- anterior (la del parche 95, idéntica a producción al 8-oct) y quita lo nuevo.
-- Las columnas prestada_id y la tabla quedan (sin uso) para no perder el registro.
begin;
create or replace function public._auth(p_dni text, p_token uuid)
 returns operarios
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  o operarios;
  v_idle  interval := interval '4 hours';
  v_max   interval := interval '18 hours';
  v_nuevo timestamptz;
begin
  select * into o from operarios
   where dni = p_dni and token = p_token
     and token_expira > now() and estado = 'ACTIVO';
  if not found then raise exception 'SESION_INVALIDA'; end if;

  if not fn_horario_ok() then raise exception 'FUERA_DE_HORARIO'; end if;

  v_nuevo := least(now() + v_idle, coalesce(o.token_creado, now()) + v_max);
  if o.token_expira < now() + (v_idle / 2) and v_nuevo > o.token_expira then
    update operarios set token_expira = v_nuevo where dni = o.dni;
    o.token_expira := v_nuevo;
  end if;

  perform _perm_set(o);
  return o;
end $function$;
drop trigger if exists marcar_prestada on public.reclamos;
drop trigger if exists marcar_prestada on public.ocurrencias;
drop trigger if exists marcar_prestada on public.movimientos_area;
drop function if exists public._marcar_prestada();
drop function if exists public.fn_sesion_prestada_detalle(text, uuid, bigint);
drop function if exists public.fn_sesiones_prestadas(text, uuid, date, text);
drop function if exists public.fn_prestada_cerrar(text, uuid, bigint);
drop function if exists public.fn_prestar_sesion(text, uuid, text, text, text, text, text);
drop function if exists public._puede_prestar(operarios, text, text);
update public.sesiones_prestadas set fin = now(), cierre = 'ROLLBACK' where fin is null;
commit;
