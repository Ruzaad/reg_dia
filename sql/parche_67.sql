-- PARCHE 67 — Carga por OF (arregla la caída de "Failed to fetch" en el cambio de turno)
--
-- DIAGNÓSTICO (logs del viernes 11 y sábado 12, hora Lima):
--   fn_tickets_area: 27 errores 500, promedio 6.7s, MÁXIMO 39.8s
--   fn_reclamar:      6 errores 504 (~5.6s)  ← el operario no podía reclamar
--   fn_login:         1 error 500            ← "no puedo ingresar"
--   fn_mi_dia / fn_residuales / fn_mis_paquetes / fn_areas_config_listar: 504
--   Pico: 2026-09-11 23:15 UTC (18:15 Lima) → 1,146 requests en 15 min, 39 errores
--
-- CAUSA: fn_tickets_area devuelve TODO el catálogo del área en un solo JSON
-- (7 a 15 MB según el área). Medido en vivo: 1.89s de Postgres puro para SACO
-- COSTURA, con un sort que se desborda a DISCO (6.5MB). Cuando ~150 personas
-- entran a la vez en el cambio de turno, esas llamadas saturan las conexiones
-- del pooler y el ancho de banda del proyecto: TODO lo demás (login incluido)
-- queda esperando y el gateway corta la conexión. En el navegador eso se ve
-- exactamente como "Failed to fetch" aunque el celular sí tenga internet.
--
-- FIX: dejar de mandar el área entera. El operario ahora recibe primero una
-- lista liviana de OF (24 a 41 filas, ~1.5 KB) y solo al elegir una OF se
-- bajan los tickets de ESA OF.
--
-- Se crean DOS funciones nuevas y NO se toca fn_tickets_area: la versión del
-- frontend que ya está publicada en Vercel la sigue usando y debe seguir
-- funcionando mientras se despliega la nueva.

-- Índice que evita el sort a disco (ordena por área, OF, n_op, paq).
create index if not exists tickets_cache_area_of_idx
  on tickets_cache(area, o_f, n_op, paq);

-- Lista liviana de OF del área, con el conteo "X de Y libres" que hoy se
-- calcula en el celular recorriendo decenas de miles de filas.
create or replace function public.fn_ofs_area(p_dni text, p_token uuid, p_area text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return coalesce((
    select json_agg(json_build_object(
        'of', z.o_f, 'articulo', z.articulo,
        'total', z.total, 'libres', z.libres) order by z.o_f)
    from (
      select t.o_f, max(t.articulo) articulo, count(*) total,
             greatest(count(*) - coalesce(max(c.n),0), 0) libres
      from tickets_cache t
      left join (select o_f, count(*) n from reclamos
                  where area = p_area and estado = 'ACTIVO' and o_f is not null
                  group by o_f) c on c.o_f = t.o_f
      where t.area = p_area
      group by t.o_f) z), '[]'::json);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Tickets de UNA OF, con su estado de reclamo. `tickets` tiene el mismo formato
-- exacto que fn_tickets_area (el front los procesa con el mismo mapDerivado),
-- y `reclamados` evita tener que pedir fn_reclamados del área entera — que en
-- CAMISA COSTURA son 41,465 filas (~2.5MB) en la misma carga inicial.
create or replace function public.fn_tickets_of(p_dni text, p_token uuid, p_area text, p_of text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare o operarios;
begin
  o := _auth(p_dni, p_token);
  return json_build_object(
    'tickets', coalesce((select json_agg(json_build_object(
        'codigo', t.codigo, 'of', t.o_f, 'articulo', t.articulo, 'modulo', t.modulo,
        'op', t.op, 'nop', t.n_op, 'op_id', t.op_id, 'std', t.std, 'cant', t.cant,
        'talla', t.talla, 'color', t.color, 'corte', t.paq::text,
        'num', t.desde::text || '-' || t.hasta::text)
        order by t.o_f, t.n_op, t.paq)
      from tickets_cache t
     where t.area = p_area and t.o_f = p_of), '[]'::json),
    'reclamados', coalesce((select json_agg(json_build_object(
        'codigo', r.codigo,
        'nombre', op2.nombres_apellidos,
        'hora', to_char(r.creado at time zone 'America/Lima','HH24:MI')))
      from reclamos r join operarios op2 on op2.dni = r.dni
     where r.area = p_area and r.o_f = p_of and r.estado = 'ACTIVO'), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
