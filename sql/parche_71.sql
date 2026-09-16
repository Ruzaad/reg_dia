-- PARCHE 71 — El área que manda es la de ORIGEN, y un ticket vale como asistencia.
--
-- ÁREA ORIGEN
--   Incentivos, la asistencia de supervisora y su lista de personal agrupaban por
--   `area_actual`. Quien está prestado a otra área (origen ACABADO, actual SACO
--   COSTURA) desaparecía de su área madre y nadie podía marcarlo. El área madre es
--   la de origen, así que es la que agrupa. Hoy son 22 de 163 operarios activos.
--   NO se toca el área de la propia supervisora (`s.area_actual`): esa es su
--   asignación, no un préstamo. Tampoco Avance ni Eficiencias, que miden lo que se
--   produjo EN el área ese día y ahí lo correcto es el área actual.
--
--   `fn_incentivos_quincena` también pasa a `area_origen`, pero su texto completo
--   vive en sql/parche_72.sql: ese parche la reescribe entera para meter el bono
--   modular, y duplicarla aquí dejaría dos versiones que se contradicen.
--
-- ASISTENCIA POR TICKET
--   Quien reclamó al menos un ticket ese día estuvo en planta: marcarlo ausente es
--   un error de captura, y en Incentivos una FALTA anula la quincena entera. La
--   lista devuelve `tickets` y, con tickets > 0, el estado efectivo pasa a ACTIVO.
--   La marca guardada NO se pisa en la base: se sigue devolviendo en
--   `estado_guardado` para que la supervisora vea la contradicción y decida.

create or replace function public.fn_asistencia_marcar_lista(p_dni text, p_token uuid, p_area text, p_fecha date)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s operarios; v_fecha date; v json;
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('INGENIERIA','SUPERVISORA') then raise exception 'NO_AUTORIZADA'; end if;
  if s.cargo = 'SUPERVISORA' and p_area <> s.area_actual then raise exception 'NO_AUTORIZADA'; end if;
  v_fecha := coalesce(p_fecha, _hoy());
  select coalesce(json_agg(json_build_object(
      'dni', z.dni, 'nombre', z.nombre,
      /* Estado efectivo: con al menos un ticket del día se considera ASISTIÓ,
         aunque haya una marca de ausencia guardada. */
      'estado', case when z.tickets > 0 then 'ACTIVO' else z.estado end,
      'estado_guardado', z.estado,
      'tickets', z.tickets,
      'por_ticket', (z.tickets > 0))
      order by z.nombre), '[]'::json)
    into v
  from (
    select o.dni, o.nombres_apellidos nombre,
           (select a.estado from asistencia a
             where a.dni = o.dni and a.fecha = v_fecha
             order by a.creado desc limit 1) estado,
           (select count(*) from reclamos r
             where r.dni = o.dni and r.fecha = v_fecha and r.estado = 'ACTIVO') tickets
      from operarios o
     where o.cargo = 'OPERARIO' and o.estado = 'ACTIVO' and o.area_origen = p_area
  ) z;
  return json_build_object('ok', true, 'fecha', to_char(v_fecha,'YYYY-MM-DD'), 'personal', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- La supervisora marca a su gente por ÁREA ORIGEN, no por dónde esté prestada.
create or replace function public.fn_asistencia_marcar_guardar(p_dni text, p_token uuid, p_fecha date, p_marcas jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s operarios; v_fecha date; m jsonb; d text; e text; n int := 0;
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('INGENIERIA','SUPERVISORA') then raise exception 'NO_AUTORIZADA'; end if;
  v_fecha := coalesce(p_fecha, _hoy());
  for m in select value from jsonb_array_elements(coalesce(p_marcas,'[]'::jsonb)) loop
    d := m->>'dni'; e := m->>'estado';
    if d is null or e is null then continue; end if;
    if not exists (select 1 from estados_asistencia where nombre = e) then continue; end if;
    -- La supervisora solo puede marcar personal de SU área (la de ORIGEN de ellos).
    if s.cargo = 'SUPERVISORA'
       and not exists (select 1 from operarios where dni = d and area_origen = s.area_actual) then
      continue;
    end if;
    insert into asistencia (dni, fecha, estado, registrado_por)
    values (d, v_fecha, e, s.dni)
    on conflict (dni, fecha)
    do update set estado = excluded.estado, registrado_por = excluded.registrado_por, creado = now();
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'afectados', n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- El personal que ve la supervisora es el de su área de ORIGEN.
create or replace function public.fn_personal(p_dni text, p_token uuid, p_area text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s operarios;
begin
  s := _auth(p_dni, p_token);
  if s.cargo not in ('SUPERVISORA','INGENIERIA') then raise exception 'NO_AUTORIZADA'; end if;
  return coalesce((
    select json_agg(json_build_object(
        'dni', o.dni, 'nombre', o.nombres_apellidos,
        'estado_dia', coalesce(_estado_dia(o.dni, _hoy()), 'ACTIVO'),
        'ausente', _ausente(_estado_dia(o.dni, _hoy())),
        'disp', case when _ausente(_estado_dia(o.dni, _hoy())) then 0
                     else 575 + coalesce((select sum(x.minutos) from ocurrencias x
                                          where x.dni = o.dni and x.fecha = _hoy()),0) end)
      order by o.nombres_apellidos)
    from operarios o
    where o.area_origen = p_area and o.estado = 'ACTIVO' and o.cargo = 'OPERARIO'
  ), '[]'::json);
end $function$;

notify pgrst, 'reload schema';
