-- Vuelta atrás del parche 86. Borra el historial acumulado.
drop trigger if exists bases_log_trg on public.bases;
drop function if exists public._bases_log_trg();
drop function if exists public.fn_bases_log(text, uuid, date, date, text);
drop table if exists public.bases_log;

create or replace function public._ing(p_dni text, p_token uuid)
 returns operarios language plpgsql security definer
 set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  if o.cargo <> 'INGENIERIA' then raise exception 'NO_AUTORIZADA'; end if;
  return o;
end $function$;

create or replace function public.fn_validar_ingenieria(p_dni text, p_token text)
 returns void language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  v operarios%rowtype;
begin
  select * into v from operarios where dni = p_dni;
  if not found or v.token::text is distinct from p_token or v.token_expira < now() then
    raise exception 'SESION_INVALIDA';
  end if;
  if v.cargo <> 'INGENIERIA' then
    raise exception 'NO_AUTORIZADA';
  end if;
end;
$function$;
