-- ROLLBACK del PARCHE 95: todo Ingeniería vuelve a leer y editar todas las áreas.
-- Restaura las RPC de lectura desde parche95_respaldo, quita los triggers y
-- deja _auth y fn_validar_ingenieria como estaban (copiadas de producción el 6 oct 2026).
-- Borra también los permisos que haya repartido el administrador.
begin;

do $$
declare r record;
begin
  for r in select def from public.parche95_respaldo loop execute r.def; end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['bases','reclamos','ocurrencias','solicitudes_ajuste','of_generada',
      'of_troceo','operaciones_extra','ops_adicionales_of','modulos_cerrados','residuales',
      'area_hora_declarada','areas_config','movimientos_area','operarios','asistencia'] loop
    execute format('drop trigger if exists perm_area_trg on public.%I', t);
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public._auth(p_dni text, p_token uuid)
 RETURNS operarios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  return o;
end $function$;

CREATE OR REPLACE FUNCTION public.fn_validar_ingenieria(p_dni text, p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform set_config('app.dni', v.dni, true);
end;
$function$;

drop function if exists public.fn_permisos_guardar(text, uuid, text, jsonb, text[]);
drop function if exists public.fn_permisos_listar(text, uuid);
drop function if exists public.fn_mis_permisos(text, uuid);
drop function if exists public._perm_area_trg();
drop function if exists public._lector(text, uuid, text);
drop function if exists public._perm_set(operarios);
drop table if exists public.permisos_pestana;
drop table if exists public.permisos_area;
drop table if exists public.parche95_respaldo;

commit;
