-- Deshace el parche 131: vuelve fn_incentivos_quincena a la versión de producción del 16-oct-2026
-- (solo operarios; las supervisoras dejan de salir en Bonificación).
begin;

CREATE OR REPLACE FUNCTION public.fn_incentivos_quincena(p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
declare v json; v_dias json; v_bonos json; v_mod json;
begin
  perform _vista(p_dni, p_token, array['pasoInc'], coalesce(p_area, ''));
  if p_hasta < p_desde then return json_build_object('ok',false,'error','Rango inválido'); end if;
  if (p_hasta - p_desde) > 40 then
    return json_build_object('ok',false,'error','Rango máximo 40 días (una quincena)'); end if;

  with dias as (
    select d::date f,
           extract(isodow from d)::int idow, _laborable(d::date) lab, _feriado(d::date) fer,
           (d::date - ((extract(isodow from d)::int - 1) * interval '1 day'))::date lunes
    from generate_series(p_desde, p_hasta, interval '1 day') d
  ),
  bloques as (
    select lunes, dense_rank() over (order by lunes) n
    from (select distinct lunes from dias where lab) z
  ),
  /* RENDIMIENTO (parche 62): UNA pasada por reclamos y otra por
     ocurrencias, apoyadas en `reclamos_fecha_dni_idx (fecha, dni)`.
     Todo lo demás sale de aquí; nada vuelve a tocar las tablas base. */
  rec as materialized (
    select r.dni, r.fecha, r.area, r.minutos
      from reclamos r
     where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO'
  ),
  ocu_r as materialized (
    select oc.dni, oc.fecha, oc.tipo, oc.minutos
      from ocurrencias oc
     where oc.fecha between p_desde and p_hasta
  ),
  /* Minutos PRODUCIDOS que no vienen de un ticket (parche 72). Solo pesan aquí. */
  cons as materialized (
    select c.dni, c.fecha, sum(c.minutos) mins
      from minutos_consideracion c
     where c.fecha between p_desde and p_hasta
     group by 1,2
  ),
  /* Eficiencia escrita a mano: se SUMA a la que salga de los tickets. */
  efm as materialized (
    select m.dni, m.fecha, m.pct from eficiencia_manual m
     where m.fecha between p_desde and p_hasta
  ),
  /* Bono modular del ÁREA por día. Los soles los pone `bono_modular_tabla`; por
     debajo de su tramo más bajo no hay fila y el día no paga. */
  mod_dia as materialized (
    select d.area, d.fecha, d.pct,
           coalesce((select t.soles from bono_modular_tabla t
                      where t.pct = least(100, round(d.pct)::int)), 0) soles
      from bono_modular_dia d
     where d.fecha between p_desde and p_hasta
  ),
  /* Semi-join sobre lo ya leído, en vez de dos `exists` correlacionados
     que disparaban un recorrido de `reclamos` POR OPERARIO. */
  activos_rango as (
    select dni from rec
    union select dni from ocu_r
    union select dni from cons
    union select dni from efm
  ),
  /* Retrospectivo: quien cesó a mitad de quincena ganó lo que ganó.
     El área que agrupa es la de ORIGEN (parche 71): quien está prestado a otra
     área sigue perteneciendo a su área madre. */
  gente as (
    select o.dni, o.nombres_apellidos nombre, o.area_origen area_base,
           /* El bono modular es del área donde la persona TRABAJA hoy: si es de
              ACABADO pero está prestada a CAMISA COSTURA, le toca el modular de
              CAMISA COSTURA, que es al que aportó. Agrupar sigue siendo por
              área de origen (parche 71). */
           o.area_actual area_mod, o.categoria,
           (o.estado <> 'ACTIVO') cesado
    from operarios o
    where (coalesce(p_area,'') = '' or o.area_origen = p_area)
      and o.cargo = 'OPERARIO'
      /* INGENIERIA no es área de planta: no entra en bonificaciones. */
      and coalesce(o.area_origen,'') <> 'INGENIERIA'
      and (o.estado = 'ACTIVO' or o.dni in (select dni from activos_rango))
  ),
  est as (
    select dni, fecha, estado from (
      select a.dni, a.fecha, a.estado,
             row_number() over (partition by a.dni, a.fecha order by a.creado desc) rn
      from asistencia a
      where a.fecha between p_desde and p_hasta) z
    where rn = 1
  ),
  prod as (
    select dni, fecha, sum(minutos) mins, count(*) tk from rec group by 1,2
  ),
  /* El JSON del desglose por área se arma UNA vez por (dni, fecha).
     Antes era una subconsulta correlacionada dentro de CADA celda. */
  areas_dia as (
    select dni, fecha, json_object_agg(area, mins) areas
      from (select dni, fecha, area, round(sum(minutos),1) mins
              from rec where area is not null group by 1,2,3) z
     group by 1,2
  ),
  ocu as (
    select dni, fecha, sum(minutos) mins from ocu_r group by 1,2
  ),
  celda as (
    select g.dni, g.categoria, g.area_base, g.area_mod, d.f, d.idow, d.lab, d.fer, d.lunes,
           coalesce(e.estado,'ACTIVO') estado,
           /* Producido = tickets + consideración. */
           coalesce(p.mins,0) + coalesce(cs.mins,0) prod,
           coalesce(p.mins,0) prod_tk,
           coalesce(cs.mins,0) cons_min,
           em.pct ef_manual,
           /* Minutos disponibles REALES del día: el turno más lo que le
              sumaron o restaron. Es contra esto que se juzga si entregó. */
           _jornada(d.f) + coalesce(o.mins,0) disp,
           coalesce(p.tk,0) tk
    from gente g cross join dias d
    left join est  e  on e.dni  = g.dni and e.fecha  = d.f
    left join prod p  on p.dni  = g.dni and p.fecha  = d.f
    left join ocu  o  on o.dni  = g.dni and o.fecha  = d.f
    left join cons cs on cs.dni = g.dni and cs.fecha = d.f
    left join efm  em on em.dni = g.dni and em.fecha = d.f
  ),
  eval as (
    select c.*,
      case
        when c.fer then 'FERIADO' when c.idow = 6 then 'SABADO'
        when c.idow = 7 then 'DOMINGO'
        when _ausente(c.estado) then c.estado
        /* Sin un solo ticket reclamado no llenó su Boleta Virtual, aunque haya
           pedido descuento de tiempo (parche 57). El `disp > 0` es el único
           eximente: sin minutos disponibles no había con qué producir.
           Los minutos de consideración y la eficiencia manual también cuentan
           como entrega (parche 72). */
        when not (c.tk > 0 or c.cons_min > 0 or c.ef_manual is not null)
             and c.disp > 0 then 'NO ENTREGO'
        /* Día activo sin minutos disponibles: no entregó, pero tampoco pudo. */
        when not (c.tk > 0 or c.cons_min > 0 or c.ef_manual is not null) then 'SIN MINUTOS'
        else null
      end etiqueta,
      case when c.lab and not _ausente(c.estado)
                and (c.tk > 0 or c.cons_min > 0 or c.ef_manual is not null)
                and c.disp > 0
           then round(c.prod / c.disp * 100, 1) + coalesce(c.ef_manual, 0)
           else null end ef
    from celda c
  ),
  pago as (
    select e.*,
      /* Tope en 100 y piso en 80. `incentivos_tabla` tiene PK
         (categoria, pct): es una búsqueda, no un recorrido. */
      case when e.ef is null or e.categoria is null then 0
           else coalesce((select t.soles from incentivos_tabla t
                           where t.categoria = e.categoria
                             and t.pct = least(100, round(e.ef)::int)
                             and round(e.ef)::int >= 80), 0) end soles
    from eval e
  ),
  por_bloque as (
    select p.dni, b.n, round(sum(p.soles),3) soles
    from pago p join bloques b on b.lunes = p.lunes
    where p.lab
    group by 1,2
  ),
  /* Promedio de eficiencia sobre TODOS los días laborables: el día sin
     porcentaje (falta, licencia, NO ENTREGO) cuenta como 0 y baja el promedio. */
  prom as (
    select dni, round(avg(coalesce(ef,0)),1) prom_ef
      from eval where lab group by 1
  ),
  /* Modular de cada persona: solo suman los días en que ESA persona tiene
     porcentaje. Si ese día estuvo de licencia, faltó o no entregó, se le
     descuenta el modular de ese día aunque el área sí lo haya ganado. */
  modular_persona as (
    select e.dni, round(sum(md.soles),3) soles, count(*) dias
      from eval e
      join mod_dia md on md.area = e.area_mod and md.fecha = e.f
     where e.lab and e.ef is not null
     group by 1
  ),
  /* Override manual de la quincena: sin fila, manda la regla del 70%. */
  ovr as (
    select dni, forzar from bono_modular_override
     where desde = p_desde and hasta = p_hasta
  ),
  /* El modular solo se paga con promedio de eficiencia >= 70%, salvo que se haya
     forzado a mano. Forzarlo levanta esa puerta, no el descuento por día: se
     siguen pagando solo los días en que la persona tuvo porcentaje. */
  modular_final as (
    select g.dni,
           coalesce(pr.prom_ef,0) prom_ef,
           coalesce(mp.soles,0) modular_bruto,
           coalesce(mp.dias,0) modular_dias,
           ov.forzar modular_forzado,
           case when ov.forzar is true  then coalesce(mp.soles,0)
                when ov.forzar is false then 0
                when coalesce(pr.prom_ef,0) >= 70 then coalesce(mp.soles,0)
                else 0 end modular
      from gente g
      left join prom pr on pr.dni = g.dni
      left join modular_persona mp on mp.dni = g.dni
      left join ovr ov on ov.dni = g.dni
  ),
  /* El modular se suma al ÚLTIMO bono de la quincena. */
  bloque_final as (select coalesce(max(n),0) n from bloques),
  bonos_calc as (
    select pb.dni, pb.n,
           round(pb.soles + case when pb.n = (select n from bloque_final)
                                 then mf.modular else 0 end, 3) soles
      from por_bloque pb
      left join modular_final mf on mf.dni = pb.dni
  ),
  faltas as (
    select dni, count(*) n from eval where etiqueta = 'FALTA' group by 1
  ),
  /* BOLETA = días en que estuvo activo, tuvo minutos y no reclamó nada.
     Se CALCULA (parche 57); ya no se digita: `incentivos_ajuste` se
     eliminó en el parche 56 y con ella CALIDAD y la nota. */
  boletas as (
    select dni, count(*) n from eval where etiqueta = 'NO ENTREGO' group by 1
  ),
  tardanzas as (
    select dni, count(*) n from ocu_r where tipo = 'TARDANZA' group by 1
  ),
  /* Un JSON por persona, armado de una vez. Antes cada persona disparaba
     un recorrido de `pago` y otro de `por_bloque`. */
  dias_json as (
    select pg.dni,
           json_object_agg(to_char(pg.f,'YYYY-MM-DD'), json_build_object(
               'ef', pg.ef, 'etiqueta', pg.etiqueta, 'soles', pg.soles,
               'prod', round(pg.prod,1), 'disp', round(pg.disp,0),
               'cons', round(pg.cons_min,1), 'ef_manual', pg.ef_manual,
               'areas', coalesce(ad.areas, '{}'::json))) dias
      from pago pg
      left join areas_dia ad on ad.dni = pg.dni and ad.fecha = pg.f
     group by pg.dni
  ),
  bonos_json as (
    select dni, json_object_agg(n::text, soles) bonos, sum(soles) bono_total
      from bonos_calc group by dni
  ),
  totales as (
    select g.dni, g.nombre, g.area_base, g.categoria, g.cesado,
           coalesce(bj.bono_total,0) bono_total,
           coalesce(bj.bonos, '{}'::json) bonos,
           coalesce(dj.dias,  '{}'::json) dias,
           coalesce(fa.n,0) faltas,
           coalesce(ta.n,0) tardanzas,
           coalesce(bo.n,0) boleta,
           coalesce(mf.prom_ef,0) prom_ef,
           coalesce(mf.modular,0) modular,
           coalesce(mf.modular_bruto,0) modular_bruto,
           coalesce(mf.modular_dias,0) modular_dias,
           mf.modular_forzado
    from gente g
    left join bonos_json bj on bj.dni = g.dni
    left join dias_json  dj on dj.dni = g.dni
    left join faltas     fa on fa.dni = g.dni
    left join tardanzas  ta on ta.dni = g.dni
    left join boletas    bo on bo.dni = g.dni
    left join modular_final mf on mf.dni = g.dni
  )
  select
    (select coalesce(json_agg(json_build_object(
        'fecha', to_char(f,'YYYY-MM-DD'), 'idow', idow,
        'laborable', lab, 'feriado', fer,
        'bloque', (select n from bloques b where b.lunes = dias.lunes))
        order by f), '[]'::json) from dias),
    (select coalesce(json_agg(json_build_object('n', n, 'lunes', to_char(lunes,'YYYY-MM-DD'),
        'ultimo', n = (select n from bloque_final))
        order by n), '[]'::json) from bloques),
    /* El cuadro del modular: lo escrito por área y día, para pintarlo aparte. */
    (select coalesce(json_agg(json_build_object(
        'area', area, 'fecha', to_char(fecha,'YYYY-MM-DD'),
        'pct', pct, 'soles', soles) order by area, fecha), '[]'::json) from mod_dia),
    coalesce((select json_agg(json_build_object(
        'dni', t.dni, 'nombre', t.nombre, 'area', t.area_base, 'categoria', t.categoria,
        'cesado', t.cesado,
        'dias', t.dias,
        'bonos', t.bonos,
        'bono_total', round(t.bono_total,3),
        'prom_ef', t.prom_ef,
        'modular', round(t.modular,3),
        'modular_bruto', round(t.modular_bruto,3),
        'modular_dias', t.modular_dias,
        'modular_forzado', t.modular_forzado,
        'faltas', t.faltas, 'tardanzas', t.tardanzas, 'boleta', t.boleta,
        /* Falta o boleta anulan la quincena con una sola. La tardanza no: recién anula a partir de la TERCERA del periodo (parche 77). */
        'penalizado', ((t.faltas + t.boleta) > 0 or t.tardanzas >= 3),
        'final', case when ((t.faltas + t.boleta) > 0 or t.tardanzas >= 3)
                      then 0 else round(t.bono_total,3) end)
        order by t.area_base, t.nombre)
      from totales t), '[]'::json)
    into v_dias, v_bonos, v_mod, v;

  return json_build_object('ok', true, 'desde', to_char(p_desde,'YYYY-MM-DD'),
    'hasta', to_char(p_hasta,'YYYY-MM-DD'), 'dias', v_dias, 'bonos', v_bonos,
    'modular', v_mod, 'personas', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

commit;
