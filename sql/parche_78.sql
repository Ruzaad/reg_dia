-- PARCHE 78 — INCENTIVOS solo para el administrador maestro (ALOPEZ)
-- El permiso va en un flag, no en el DNI escrito en el código: mover el
-- administrador maestro, o repartir permisos por analista más adelante, es un
-- UPDATE y no un parche de frontend.

alter table operarios
  add column if not exists es_admin boolean not null default false;

update operarios set es_admin = true  where dni = 'ALOPEZ';
update operarios set es_admin = false where dni <> 'ALOPEZ' and es_admin;

create or replace function public._admin(p_dni text, p_token uuid)
 returns operarios language plpgsql security definer set search_path to 'public'
as $function$
declare o operarios;
begin
  o := _ing(p_dni, p_token);
  if not coalesce(o.es_admin, false) then raise exception 'NO_AUTORIZADA'; end if;
  return o;
end $function$;

revoke execute on function public._admin(text, uuid) from public, anon, authenticated;

-- Las 12 RPC de la pestaña cambian su guardia de _ing a _admin. Se parchea
-- sobre la definición viva: son 12 cuerpos largos y transcribirlos a mano solo
-- agrega formas de equivocarse. Re-ejecutable.
do $$
declare r record; d text; n int; cambiadas int := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace nn on nn.oid = p.pronamespace
     where nn.nspname = 'public' and p.proname in (
       'fn_bono_modular_guardar','fn_bono_modular_listar','fn_bono_modular_override',
       'fn_bono_modular_tabla_listar','fn_consideracion_eliminar','fn_consideracion_guardar',
       'fn_consideracion_listar','fn_ef_manual_guardar','fn_ef_manual_listar',
       'fn_ef_tickets_rango','fn_incentivos_quincena','fn_incentivos_tabla_listar')
  loop
    d := pg_get_functiondef(r.oid);
    if position('_admin(p_dni' in d) > 0 then continue; end if;

    n := (length(d) - length(replace(d, '_ing(p_dni, p_token)', ''))) / length('_ing(p_dni, p_token)');
    if n <> 1 then
      raise exception 'Esperaba 1 llamada a _ing en %, encontré %', r.proname, n;
    end if;
    d := replace(d, '_ing(p_dni, p_token)', '_admin(p_dni, p_token)');
    execute d;
    cambiadas := cambiadas + 1;
  end loop;
  raise notice 'RPC de incentivos blindadas: %', cambiadas;
end $$;

-- fn_login devuelve `es_admin` para que el frontend no pinte la pestaña.
-- (cuerpo completo en el parche aplicado; solo se agregó esa clave al JSON)

-- ---------- DESLOGUEO GENERAL ----------
-- Invalida TODAS las sesiones vivas. El frontend recibe SESION_INVALIDA, avisa
-- y manda a la pantalla de ingreso (parche 74). Lo ya registrado no se pierde.
-- update operarios set token = null, token_expira = null, token_creado = null
--  where token is not null;
