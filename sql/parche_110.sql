-- PARCHE 110 — Modo sin señal: registrar con la hora en que se marcó
-- Si al registrar se corta la señal, el celular guarda los paquetes y los
-- manda solo al volver la señal. Esta función recibe la hora en que se
-- marcaron (solo de hoy o de ayer). Si fue ayer, el reclamo queda con fecha de
-- ayer y motivo FALTA DE INTERNET (el mismo que ya usa Ingeniería al mover
-- fechas). Si otra persona tomó el paquete mientras tanto, se rechaza igual
-- que hoy y el celular lo avisa.
-- No cambia fn_reclamar_lote: los despliegues sin actualizar siguen igual.
-- Rollback: drop function public.fn_reclamar_lote_hora(text, uuid, text, jsonb, timestamptz);
begin;

create or replace function public.fn_reclamar_lote_hora(p_dni text, p_token uuid, p_area text, p_tickets jsonb, p_marcado timestamptz)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_f date; r json; v_n int := 0;
begin
  perform _auth(p_dni, p_token);
  if p_marcado is null or p_marcado > now() + interval '5 minutes' then
    return json_build_object('ok', false, 'error', 'Hora del celular inválida');
  end if;
  v_f := (p_marcado at time zone 'America/Lima')::date;
  if v_f < _hoy() - 1 then
    return json_build_object('ok', false, 'vencido', true,
      'error', 'Se marcó hace más de un día. Pide a Ingeniería que lo registre con su fecha.');
  end if;
  perform pg_advisory_xact_lock(hashtext('reclamar_hora:' || p_dni));
  r := fn_reclamar_lote(p_dni, p_token, p_area, p_tickets);
  if (r->>'ok')::boolean and v_f < _hoy() then
    -- Solo lo insertado en esta misma llamada (creado = inicio de la transacción).
    update reclamos set fecha = v_f, motivo_fecha = 'FALTA DE INTERNET'
     where dni = p_dni and area = p_area and estado = 'ACTIVO' and creado = now()
       and codigo in (select t->>'codigo' from jsonb_array_elements(p_tickets) t);
    get diagnostics v_n = row_count;
  end if;
  return (r::jsonb || jsonb_build_object('fecha', v_f, 'movidos_a_ayer', v_n))::json;
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%FUERA_DE_HORARIO%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
