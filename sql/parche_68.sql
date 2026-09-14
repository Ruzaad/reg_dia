-- PARCHE 68 — Resumen de OF: todas las operaciones del balance, sin filtro de nivel
--
-- QUÉ CAMBIA EN LA VISTA
--   · La tabla principal queda en: Artículo · OF · Corte real · Entrada · Salida · Estado
--     (se quita la columna "Módulos listos").
--   · El detalle ▾ pasa a mostrar, por módulo, TODAS las operaciones del balance
--     (BASE) con lo producido, su porcentaje y su estado (EN PROCESO / COMPLETADO).
--     Antes solo se veía UNA operación por módulo (la última o la penúltima).
--   · Desaparece el selector "última / penúltima del módulo": la referencia del
--     módulo es SIEMPRE su operación final. El único filtro que queda es el buscador
--     y se listan TODAS las OF (terminadas y en proceso) en una sola tabla.
--   · Se añade `of_cod`: el código de 10 dígitos del ERP (4 + la OF rellenada con
--     ceros, 10136 → 4000010136). Solo se usa en el Excel; en pantalla la OF se
--     sigue leyendo corta.
--   · Los módulos se ordenan por el N°OP de su operación final (el orden de la
--     ruta) y no por el nombre del módulo. Acabado sigue yendo al final.
--   · Filtro de periodo por meses (`p_desde` / `p_hasta`, ambos opcionales).
--
-- LA REGLA DEL PERIODO
--   Una OF aparece en el periodo si su ventana de actividad lo toca, así que sale
--   tanto en el mes en que EMPEZÓ como en el mes en que TERMINÓ: una que arrancó
--   en agosto y cerró en setiembre se ve en los dos, con sus fechas reales sin
--   recortar. El filtro elige QUÉ OF se devuelven; el cálculo (producida, %,
--   entrada, salida, estado) sigue siendo acumulativo sobre toda la historia.
--   Con los dos parámetros en null salen todas, que es lo que había hasta ahora.
--   Efecto de borde: una OF en proceso sin ningún ticket dentro del rango no sale;
--   se la ve ampliando el rango hasta el mes en que sí tuvo movimiento.
--
-- POR QUÉ HAY QUE BORRAR LA FUNCIÓN DE 3 ARGUMENTOS
--   `create or replace` con otra lista de argumentos no reemplaza: SOBRECARGA. Si
--   convivieran las dos, PostgREST no sabría cuál elegir al recibir
--   {p_dni, p_token, p_nivel} y devolvería 300 Multiple Choices. Con UNA sola
--   función de 5 argumentos y defaults resuelven las dos llamadas: la del frontend
--   viejo ({p_dni,p_token,p_nivel}) y la del nuevo ({p_dni,p_token,p_desde,p_hasta}).
--
-- POR QUÉ SE ACTUALIZA LA FUNCIÓN EN VEZ DE CREAR OTRA
--   El mismo repo está publicado en Netlify, Vercel y GitHub Pages contra ESTA base
--   y un push a `main` no actualiza los tres a la vez, así que `p_nivel` SE CONSERVA
--   como primer parámetro opcional: un frontend que todavía lo mande sigue
--   resolviendo en PostgREST y sigue recibiendo los campos que pinta (`nivel`,
--   `n_mods`, `n_listos`, y en cada módulo `operacion`, `nop`, `producida`,
--   `cant_prog`, `ruta_base`, `es_acabado`). Se acepta y se ignora: la referencia es
--   siempre la operación final. Y como no manda `p_desde`/`p_hasta`, recibe todas
--   las OF, igual que antes.
--   Único detalle cosmético en un frontend viejo: el estado del módulo llega como
--   'COMPLETADO' en vez de 'TERMINADO', y su pastilla se pinta ámbar en vez de verde
--   hasta que ese despliegue se actualice.
--
-- CAMBIOS DE CÁLCULO
--   · `ruta` ya no recorta a la última/penúltima: trae TODAS las operaciones del
--     balance del módulo. `ops` le suma los N°OP reclamados que la BASE no tiene,
--     para que un módulo sin ruta no salga vacío.
--   · La referencia del módulo (salida/estado) es la operación de mayor N°OP.
--   · `pct` = producida / corte real de la OF, por operación y por módulo.
--   · Estado de módulo y de operación: COMPLETADO / EN PROCESO.
--
-- RENDIMIENTO (medido en producción, 149 OF · 910 módulos · 9.595 operaciones)
--   antes → 4,3 s · 281 kB      después → 4,3 s · 1,7 MB (sin filtro, todas)
--   con el periodo en un mes → 3,7 s · 1,2 MB para 89 OF: la respuesta baja con
--   las OF seleccionadas. El piso de ~3,5 s es el recorrido de `reclamos`, que
--   crece con la historia aunque se filtre; lo que el filtro acota —y es lo que
--   revienta el gateway y la descarga— es el tamaño de la respuesta. A ~100 OF
--   nuevas al mes y ~12 kB por OF, sin filtro esto llegaría a ~8 MB y ~30 s
--   alrededor de los 6 meses.
--   El JSON de módulos y el de operaciones se arman AGRUPANDO (`opsjson`/`modjson`),
--   no con subconsultas correlacionadas por módulo: con el correlacionado la misma
--   respuesta tardaba 7,4 s porque recorría las 9.595 operaciones una vez por módulo.
--   Es una vista solo de ingeniería (escritorio) y se pide a mano con "Cargar", así
--   que no entra en la carga del cambio de turno (ver parche 67).

drop function if exists public.fn_of_trazabilidad(text, uuid, text);

create function public.fn_of_trazabilidad(p_dni text, p_token uuid, p_nivel text default 'PENULTIMA',
                                          p_desde date default null, p_hasta date default null)
returns json
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare v json;
begin
  perform _ing(p_dni, p_token);
  /* p_nivel queda solo por compatibilidad: los frontends aún no actualizados lo
     siguen mandando. La referencia del módulo es SIEMPRE su operación final. */

  with recall as materialized (
    /* Reclamos activos de cada OF. `_nk` en el o_f porque la grafía de la OF
       no es uniforme en los reclamos anteriores al parche 26. Se recorre UNA
       vez: de aquí salen tanto la ventana del filtro como el detalle. */
    select f.o_f, f.cant_prog,
           r.area,
           coalesce(nullif(trim(r.modulo),''),'(sin módulo)') modulo,
           coalesce(nullif(trim(r.articulo),''), f.articulo) articulo,
           r.nop, r.op, r.cant, r.creado
      from ofs f
      join reclamos r on _nk(r.o_f) = _nk(f.o_f)
     where r.estado = 'ACTIVO'
  ),
  ventana as (
    /* Ventana de actividad de cada OF: primer y último ticket, o la fecha de
       carga si todavía no tiene ninguno. Contiene por construcción su inicio y
       su final reales, así que filtrar por aquí nunca deja fuera una OF que
       empezó o terminó dentro del periodo. */
    select f.o_f,
           coalesce(v.ent0, f.fecha_carga) ent0,
           coalesce(v.ult,  f.fecha_carga) ult
      from ofs f
      left join (select o_f, min(creado) ent0, max(creado) ult
                   from recall group by o_f) v on v.o_f = f.o_f
  ),
  sel as (
    /* El periodo recorta QUÉ OF se devuelven, nunca el cálculo: producida, %,
       entrada, salida y estado se siguen acumulando sobre TODA la historia. Esa
       es la trampa del parche 61: si el rango recortara los reclamos, una OF a
       caballo entre dos meses saldría EN PROCESO porque las unidades del mes
       anterior quedarían fuera.
       Una OF entra si su ventana toca el periodo, así que sale tanto en el mes
       en que empezó como en el mes en que terminó, y sus columnas Entrada y
       Salida siguen mostrando las fechas reales, no recortadas al rango.
       Con p_desde/p_hasta en null salen todas. */
    select o_f from ventana
     where (p_desde is null or (ult  at time zone 'America/Lima')::date >= p_desde)
       and (p_hasta is null or (ent0 at time zone 'America/Lima')::date <= p_hasta)
  ),
  rec as materialized (
    select r.* from recall r where r.o_f in (select o_f from sel)
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
        /* Por N°OP de la operación final, que es el orden de la ruta: así el
           módulo se lee en el orden en que la prenda lo recorre y no por el
           nombre del módulo. Acabado va al final, en su propio cuadro, y
           ordenado por su propia secuencia. */
        order by (x.area = 'ACABADO'), x.area, x.ref_nop nulls last, x.modulo) mods
      from fila x
      left join opsjson oj on oj.o_f = x.o_f and oj.area = x.area and oj.modulo = x.modulo
     group by x.o_f
  )
  select coalesce(json_agg(json_build_object(
      'of', f.o_f,
      /* Código de 10 dígitos que usa el ERP: 4 + la OF rellenada con ceros
         (10136 → 4000010136). Va junto a la OF corta, no en su lugar. */
      'of_cod', '4' || lpad(f.o_f, 9, '0'),
      'articulo', f.articulo,
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
    join sel s on s.o_f = f.o_f
    left join porof a   on a.o_f  = f.o_f
    left join modjson mj on mj.o_f = f.o_f;

  /* `nivel` se sigue devolviendo para los frontends viejos, que lo pintan. */
  return json_build_object('ok', true, 'nivel', 'ULTIMA', 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- La v2 fue un paso intermedio de este mismo parche: nunca llegó a producción
-- (ningún despliegue publicado la llamó) y se borra.
drop function if exists public.fn_of_trazabilidad_v2(text, uuid);

notify pgrst, 'reload schema';
