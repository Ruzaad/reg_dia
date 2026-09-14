-- PARCHE 68 — Resumen de OF: todas las operaciones del balance, sin filtro de nivel
--
-- QUÉ PEDÍA EL CAMBIO
--   · La tabla principal queda en: Artículo · OF · Corte real · Entrada · Salida · Estado
--     (se quita la columna "Módulos listos").
--   · El detalle ▾ pasa a mostrar, por módulo, TODAS las operaciones del balance
--     (BASE) con lo producido, su porcentaje y su estado (EN PROCESO / COMPLETADO).
--     Antes solo se veía UNA operación por módulo (la última o la penúltima).
--   · Desaparece el selector "última / penúltima del módulo": la referencia del
--     módulo es SIEMPRE su operación final. El único filtro que queda es el buscador
--     y se listan TODAS las OF (terminadas y en proceso) en una sola tabla.
--
-- POR QUÉ UNA FUNCIÓN NUEVA Y NO UN REEMPLAZO
--   El mismo repo está publicado en Netlify, Vercel y GitHub Pages contra ESTA base.
--   Un push a `main` no actualiza los tres a la vez, así que `fn_of_trazabilidad`
--   (con p_nivel) se queda intacta mientras siga habiendo frontends viejos
--   llamándola. Una vez que los tres despliegues sirvan esta versión y los logs no
--   registren llamadas a la vieja, se puede borrar — pedir confirmación antes.
--
-- CAMBIOS DE CÁLCULO RESPECTO DE fn_of_trazabilidad
--   · `ruta` ya no recorta a la última/penúltima: trae TODAS las operaciones del
--     balance del módulo. `ops` le suma los N°OP reclamados que la BASE no tiene,
--     para que un módulo sin ruta no salga vacío.
--   · La referencia del módulo (entrada/salida/estado) es la operación de mayor
--     N°OP, ya no depende de p_nivel.
--   · `pct` = producida / corte real de la OF, por operación y por módulo.
--   · Estado de módulo y de operación: COMPLETADO / EN PROCESO.
--
-- RENDIMIENTO (medido en producción, 149 OF · 910 módulos · 9.595 operaciones)
--   fn_of_trazabilidad     → 4,3 s · 281 kB
--   fn_of_trazabilidad_v2  → 4,6 s · 1,7 MB
--   El JSON de módulos y el de operaciones se arman AGRUPANDO (`opsjson`/`modjson`),
--   no con subconsultas correlacionadas por módulo: con el correlacionado la misma
--   respuesta tardaba 7,4 s porque recorría las 9.595 operaciones una vez por módulo.
--   Es una vista solo de ingeniería (escritorio) y se pide a mano con "Cargar".


create or replace function public.fn_of_trazabilidad_v2(p_dni text, p_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare v json;
begin
  perform _ing(p_dni, p_token);

  with rec as materialized (
    /* Reclamos activos de cada OF. `_nk` en el o_f porque la grafía de la OF
       no es uniforme en los reclamos anteriores al parche 26. */
    select f.o_f, f.cant_prog,
           r.area,
           coalesce(nullif(trim(r.modulo),''),'(sin módulo)') modulo,
           coalesce(nullif(trim(r.articulo),''), f.articulo) articulo,
           r.nop, r.op, r.cant, r.creado
      from ofs f
      join reclamos r on _nk(r.o_f) = _nk(f.o_f)
     where r.estado = 'ACTIVO'
  ),
  mods as materialized (
    select o_f, cant_prog, area, modulo,
           max(articulo) articulo,
           min(creado) entrada,
           max(creado) ultimo_ticket
      from rec
     group by o_f, cant_prog, area, modulo
  ),
  prodop as materialized (
    /* Lo notificado por operación: la base del % de cada fila del detalle. */
    select o_f, area, modulo, nop, max(op) op, sum(cant) producida
      from rec where nop is not null
     group by o_f, area, modulo, nop
  ),
  ruta as materialized (
    /* TODAS las operaciones del balance (BASE) del módulo, no solo la última.
       Búsqueda por índice: `_nk(m.articulo)` es constante por fila y
       `_nk(b2.articulo)` es la expresión indexada. */
    select m.o_f, m.area, m.modulo, b.n_op, b.operacion
      from mods m
      join lateral (
        select distinct on (b2.n_op) b2.n_op, b2.operacion
          from bases b2
         where b2.area = m.area
           and _nk(b2.articulo) = _nk(m.articulo)
           and _nk(b2.modulo)   = _nk(m.modulo)
           and coalesce(b2.n_op,0) > 0
         order by b2.n_op, b2.id
      ) b on true
  ),
  ops as (
    /* El balance manda; lo reclamado con un N°OP que la BASE no tiene se
       añade igual para que el módulo sin ruta no salga vacío. */
    select o_f, area, modulo, n_op, operacion, true en_base from ruta
    union all
    select p.o_f, p.area, p.modulo, p.nop, p.op, false
      from prodop p
      left join ruta r on r.o_f = p.o_f and r.area = p.area
                      and r.modulo = p.modulo and r.n_op = p.nop
     where r.n_op is null
  ),
  opsf as materialized (
    select o.o_f, o.area, o.modulo, o.n_op, o.operacion, o.en_base,
           m.cant_prog,
           coalesce(pp.producida, 0) producida,
           row_number() over (partition by o.o_f, o.area, o.modulo
                              order by o.n_op desc) rn_fin
      from ops o
      join mods m on m.o_f = o.o_f and m.area = o.area and m.modulo = o.modulo
      left join prodop pp on pp.o_f = o.o_f and pp.area = o.area
                         and pp.modulo = o.modulo and pp.nop = o.n_op
  ),
  fin as (
    /* Operación FINAL del módulo: la referencia con la que se decide salida y
       estado del módulo (ya no hay selector última/penúltima). */
    select o_f, area, modulo, n_op ref_nop, operacion ref_op, en_base ruta_base,
           producida ref_prod
      from opsf where rn_fin = 1
  ),
  prod as (
    select fn.o_f, fn.area, fn.modulo, rc.creado, sum(rc.cant) c
      from fin fn
      join rec rc on rc.o_f = fn.o_f and rc.area = fn.area
                 and rc.modulo = fn.modulo and rc.nop = fn.ref_nop
     group by 1,2,3,4
  ),
  acum as (
    select p.*, sum(p.c) over (partition by p.o_f, p.area, p.modulo
                               order by p.creado
                               rows between unbounded preceding and current row) cum
      from prod p
  ),
  llego as (
    select a.o_f, a.area, a.modulo, min(a.creado) f_salida
      from acum a
      join mods m on m.o_f = a.o_f and m.area = a.area and m.modulo = a.modulo
     where a.cum >= m.cant_prog
     group by 1,2,3
  ),
  fila as (
    select m.o_f, m.cant_prog, m.area, m.modulo, m.articulo, m.entrada,
           fn.ref_nop, fn.ref_op, fn.ruta_base, coalesce(fn.ref_prod,0) producida,
           /* exists, no join: la PK de modulos_cerrados es sobre el texto
              crudo y dos grafías colapsan al mismo _nk → duplicaría filas. */
           coalesce(l.f_salida,
             case when exists(select 1 from modulos_cerrados mc
                               where mc.area = m.area
                                 and _nk(mc.o_f)    = _nk(m.o_f)
                                 and _nk(mc.modulo) = _nk(m.modulo))
                  then m.ultimo_ticket end) salida
      from mods m
      left join fin   fn on fn.o_f = m.o_f and fn.area = m.area and fn.modulo = m.modulo
      left join llego l  on l.o_f  = m.o_f and l.area  = m.area and l.modulo  = m.modulo
  ),
  porof as (
    select o_f,
           min(entrada) entrada,
           count(*) n_mods,
           count(salida) n_listos,
           case when count(*) = count(salida) then max(salida) end salida
      from fila group by o_f
  ),
  opsjson as (
    /* Se arma agrupando, no con subconsulta correlacionada por módulo: son
       ~900 módulos contra ~9.600 operaciones y el correlacionado lo recorría
       entero una vez por módulo. */
    select o_f, area, modulo,
           json_agg(json_build_object(
             'nop', n_op, 'operacion', operacion,
             'producida', round(producida,0),
             'cant_prog', round(cant_prog,0),
             'pct', case when coalesce(cant_prog,0) > 0
                         then round(100 * producida / cant_prog, 1) end,
             'en_base', en_base,
             'estado', case when coalesce(cant_prog,0) > 0 and producida >= cant_prog
                            then 'COMPLETADO' else 'EN PROCESO' end)
             order by n_op) ops
      from opsf group by o_f, area, modulo
  ),
  modjson as (
    select x.o_f, json_agg(json_build_object(
        'area', x.area, 'modulo', x.modulo, 'articulo', x.articulo,
        'operacion', x.ref_op, 'nop', x.ref_nop, 'ruta_base', x.ruta_base,
        'producida', round(x.producida,0),
        'cant_prog', round(x.cant_prog,0),
        'pct', case when coalesce(x.cant_prog,0) > 0
                    then round(100 * x.producida / x.cant_prog, 1) end,
        'entrada', to_char(x.entrada at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
        'salida',  to_char(x.salida  at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
        'estado', case when x.salida is not null then 'COMPLETADO' else 'EN PROCESO' end,
        /* La regla "es acabado" vive aquí y en app.js:728. No hay bandera en
           areas_config; si mañana hay un segundo área de acabado hay que
           añadirla en los dos sitios. */
        'es_acabado', (x.area = 'ACABADO'),
        'operaciones', coalesce(oj.ops, '[]'::json))
        order by (x.area = 'ACABADO'), x.area, x.modulo) mods
      from fila x
      left join opsjson oj on oj.o_f = x.o_f and oj.area = x.area and oj.modulo = x.modulo
     group by x.o_f
  )
  select coalesce(json_agg(json_build_object(
      'of', f.o_f, 'articulo', f.articulo,
      'cant_prog', round(f.cant_prog,0),
      'entrada', to_char(a.entrada at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'salida',  to_char(a.salida  at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'n_mods',   coalesce(a.n_mods,0),
      'n_listos', coalesce(a.n_listos,0),
      'estado', case when coalesce(a.n_mods,0) > 0 and a.n_mods = a.n_listos
                     then 'TERMINADA' else 'EN PROCESO' end,
      'modulos', coalesce(mj.mods, '[]'::json))
      order by a.entrada desc nulls last, f.o_f), '[]'::json)
    into v
    from ofs f
    left join porof a   on a.o_f  = f.o_f
    left join modjson mj on mj.o_f = f.o_f;

  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- Los permisos salen iguales a los de fn_of_trazabilidad (anon ejecuta vía PostgREST).
notify pgrst, 'reload schema';

-- NO se borra fn_of_trazabilidad(p_dni, p_token, p_nivel): la siguen llamando los
-- despliegues que aún no tengan esta versión del frontend. Borrarla es un paso
-- aparte, con confirmación, cuando los logs no registren más llamadas.
