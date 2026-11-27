-- Deshace el parche 200 (vuelve a _pcp_editor del 144: admin o EDITAR en alguna área)
begin;
drop trigger if exists rol_trg on public.operarios;
drop function if exists public._rol_trg();
drop function if exists public._rol_aplicar(text, text);
drop function if exists public.fn_roles_listar(text, text);
drop function if exists public.fn_roles_guardar(text, uuid, text, text[]);
drop function if exists public.fn_roles_eliminar(text, uuid, text);
drop table if exists public.roles_sistema;
create or replace function public._pcp_editor(p_dni text, p_token uuid)
 returns operarios language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _vista(p_dni, p_token, array['pasoPcp']);
  if not (coalesce(o.es_admin, false) or exists (select 1 from permisos_area where dni = o.dni and nivel = 'EDITAR')) then
    raise exception 'NO_AUTORIZADA: solo lectura en PCP';
  end if;
  return o;
end $function$;
commit;
