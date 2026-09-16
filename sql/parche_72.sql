-- PARCHE 72 — Bono modular, eficiencia manual y minutos de consideración.
--
-- Tres cosas distintas que conviene no confundir:
--   · BONO MODULAR   — del ÁREA y del DÍA. No mira categorías. Lo escribe
--     ingeniería: "el 9-set ACABADO llegó a 90%". Los soles los pone la tabla.
--   · EFICIENCIA MANUAL — de la PERSONA y del DÍA, en %. Para áreas que no llevan
--     tickets. SUMA a la que salga de los tickets.
--   · MINUTOS DE CONSIDERACIÓN — de la PERSONA y del DÍA, en minutos PRODUCIDOS
--     que no vienen de ningún ticket. Es la vía para subirle la eficiencia a quien
--     ya tiene tickets.
-- Las dos últimas solo pesan en INCENTIVOS: las demás pantallas siguen contando
-- únicamente lo reclamado.
--
-- CÓMO SE REPARTE EL MODULAR
--   1. Se suman los soles de cada día del rango para el área.
--   2. Cada persona solo cobra los días en que ELLA tuvo porcentaje: si faltó,
--      estuvo de licencia o no entregó, se le descuenta el modular de ese día
--      aunque el área sí lo haya ganado.
--   3. Se paga solo con promedio de eficiencia >= 70%. El promedio va sobre TODOS
--      los días laborables: el día sin porcentaje cuenta 0 y lo baja.
--   4. Lo que resulte se suma al ÚLTIMO bono de la quincena.

/* Tramos del bono modular: % alcanzado por el área -> soles. Sin categorías. */
create table if not exists bono_modular_tabla (
  pct   int primary key check (pct between 0 and 100),
  soles numeric not null default 0
);

insert into bono_modular_tabla (pct, soles) values
  (80,6),(81,6),(82,6),(83,6),(84,6),
  (85,7),(86,7),(87,7),(88,7),(89,7),
  (90,8),(91,8),(92,8),(93,8),(94,8),
  (95,9),(96,9),(97,9),(98,9),(99,9),
  (100,10)
on conflict (pct) do update set soles = excluded.soles;

/* Lo que ingeniería escribe: qué % alcanzó cada área cada día. Por debajo del
   tramo más bajo de la tabla el día simplemente no paga. */
create table if not exists bono_modular_dia (
  area           text not null,
  fecha          date not null,
  pct            numeric not null check (pct >= 0),
  registrado_por text,
  creado         timestamptz not null default now(),
  primary key (area, fecha)
);
create index if not exists bono_modular_dia_fecha_idx on bono_modular_dia (fecha);

/* Eficiencia escrita a mano, por persona y día. Se SUMA a la de tickets: por eso
   el frontend avisa del porcentaje resultante antes de guardar. */
create table if not exists eficiencia_manual (
  dni            text not null,
  fecha          date not null,
  pct            numeric not null,
  registrado_por text,
  creado         timestamptz not null default now(),
  primary key (dni, fecha)
);
create index if not exists eficiencia_manual_fecha_idx on eficiencia_manual (fecha);

/* Minutos producidos que no salen de un ticket. Varias líneas por día y persona
   (cada una con su motivo), por eso lleva id propio y no PK compuesta. */
create table if not exists minutos_consideracion (
  id             bigserial primary key,
  dni            text not null,
  fecha          date not null,
  minutos        numeric not null,
  motivo         text,
  registrado_por text,
  creado         timestamptz not null default now()
);
create index if not exists minutos_consideracion_fecha_dni_idx on minutos_consideracion (fecha, dni);

/* Las tres se leen y escriben SOLO por RPC (security definer), como el resto. */
alter table bono_modular_tabla     enable row level security;
alter table bono_modular_dia       enable row level security;
alter table eficiencia_manual      enable row level security;
alter table minutos_consideracion  enable row level security;

/* ---------- INCENTIVOS: integra las tres cosas ----------
   Un día cuenta como ENTREGA si hubo ticket, minutos de consideración O
   eficiencia manual: sin eso, alguien de un área sin tickets caería en
   NO ENTREGO y la penalidad le anularía la quincena. */
create or replace function public.fn_incentivos_quincena(p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text)
returns json
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare v json; v_dias json; v_bonos json; v_mod json;
begin
  perform _ing(p_dni, p_token);
  if p_hasta < p_desde then return json_build_object('ok',false,'error','Rango inválido'); end if;
  if (p_hasta - p_desde) > 40 then
    return json_build_object('ok',false,'error','Rango máximo 40 días (una quincena)'); end if;

  with dias as (
    select d::date f,
           extract(isodow from d)::int idow,
           (d::date - ((extract(isodow from d)::int - 1) * interval '1 day'))::date lunes
    from generate_series(p_desde, p_hasta, interval '1 day') d
  ),
  bloques as (
    select lunes, dense_rank() over (order by lunes) n
    from (select distinct lunes from dias where idow <= 5) z
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
    select o.dni, o.nombres_apellidos nombre, o.area_origen area_base, o.categoria,
           (o.estado <> 'ACTIVO') cesado
    from operarios o
    where (coalesce(p_area,'') = '' or o.area_origen = p_area)
      and o.cargo = 'OPERARIO'
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
    select g.dni, g.categoria, g.area_base, d.f, d.idow, d.lunes,
           coalesce(e.estado,'ACTIVO') estado,
           /* Producido = tickets + consideración. */
           coalesce(p.mins,0) + coalesce(cs.mins,0) prod,
           coalesce(p.mins,0) prod_tk,
           coalesce(cs.mins,0) cons_min,
           em.pct ef_manual,
           /* Minutos disponibles REALES del día: el turno más lo que le
              sumaron o restaron. Es contra esto que se juzga si entregó. */
           575 + coalesce(o.mins,0) disp,
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
        when c.idow = 6 then 'SABADO'
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
      case when c.idow <= 5 and not _ausente(c.estado)
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
    where p.idow <= 5
    group by 1,2
  ),
  /* Promedio de eficiencia sobre TODOS los días laborables: el día sin
     porcentaje (falta, licencia, NO ENTREGO) cuenta como 0 y baja el promedio. */
  prom as (
    select dni, round(avg(coalesce(ef,0)),1) prom_ef
      from eval where idow <= 5 group by 1
  ),
  /* Modular de cada persona: solo suman los días en que ESA persona tiene
     porcentaje. Si ese día estuvo de licencia, faltó o no entregó, se le
     descuenta el modular de ese día aunque el área sí lo haya ganado. */
  modular_persona as (
    select e.dni, round(sum(md.soles),3) soles, count(*) dias
      from eval e
      join mod_dia md on md.area = e.area_base and md.fecha = e.f
     where e.idow <= 5 and e.ef is not null
     group by 1
  ),
  /* El modular solo se paga con promedio de eficiencia >= 70%. */
  modular_final as (
    select g.dni,
           coalesce(pr.prom_ef,0) prom_ef,
           coalesce(mp.soles,0) modular_bruto,
           coalesce(mp.dias,0) modular_dias,
           case when coalesce(pr.prom_ef,0) >= 70 then coalesce(mp.soles,0) else 0 end modular
      from gente g
      left join prom pr on pr.dni = g.dni
      left join modular_persona mp on mp.dni = g.dni
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
           coalesce(mf.modular_dias,0) modular_dias
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
        'laborable', idow <= 5,
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
        'faltas', t.faltas, 'tardanzas', t.tardanzas, 'boleta', t.boleta,
        /* Cualquier penalidad anula toda la quincena. */
        'penalizado', (t.faltas + t.tardanzas + t.boleta) > 0,
        'final', case when (t.faltas + t.tardanzas + t.boleta) > 0
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

/* ---------- BONO MODULAR ---------- */

create or replace function public.fn_bono_modular_tabla_listar(p_dni text, p_token uuid)
returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _ing(p_dni, p_token);
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object('pct', pct, 'soles', soles) order by pct)
      from bono_modular_tabla), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* Lo escrito por área y día en el rango, con los soles ya resueltos y el total
   por área: es el cuadro que se pinta antes de la quincena. */
create or replace function public.fn_bono_modular_listar(
  p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text default null)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_area text := nullif(trim(coalesce(p_area,'')), '');
begin
  perform _ing(p_dni, p_token);
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object(
        'area', z.area, 'fecha', to_char(z.fecha,'YYYY-MM-DD'),
        'pct', z.pct, 'soles', z.soles) order by z.area, z.fecha)
      from (select d.area, d.fecha, d.pct,
                   coalesce((select t.soles from bono_modular_tabla t
                              where t.pct = least(100, round(d.pct)::int)), 0) soles
              from bono_modular_dia d
             where d.fecha between p_desde and p_hasta
               and (v_area is null or d.area = v_area)) z), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* Guardado en lote del cuadro: [{area, fecha, pct}]. `pct` nulo o vacío BORRA la
   fila, que es como se quita un día que no debía pagar. */
create or replace function public.fn_bono_modular_guardar(
  p_dni text, p_token uuid, p_cambios jsonb)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; c jsonb; v_area text; v_fecha date; v_pct numeric;
        n_up int := 0; n_del int := 0;
begin
  s := _ing(p_dni, p_token);
  for c in select value from jsonb_array_elements(coalesce(p_cambios,'[]'::jsonb)) loop
    v_area  := nullif(trim(coalesce(c->>'area','')), '');
    v_fecha := (c->>'fecha')::date;
    if v_area is null or v_fecha is null then continue; end if;
    v_pct := nullif(trim(coalesce(c->>'pct','')), '')::numeric;
    if v_pct is null then
      delete from bono_modular_dia where area = v_area and fecha = v_fecha;
      n_del := n_del + 1;
    else
      insert into bono_modular_dia (area, fecha, pct, registrado_por)
      values (v_area, v_fecha, v_pct, s.dni)
      on conflict (area, fecha) do update
        set pct = excluded.pct, registrado_por = excluded.registrado_por, creado = now();
      n_up := n_up + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'guardados', n_up, 'borrados', n_del);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* ---------- EFICIENCIA MANUAL ---------- */

/* La rejilla: personas del área (por ORIGEN) × días del rango. De cada celda se
   devuelve la eficiencia que sale de los tickets y la escrita a mano, porque el
   frontend tiene que avisar del porcentaje resultante (se SUMAN) antes de guardar. */
create or replace function public.fn_ef_manual_listar(
  p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
returns json language plpgsql security definer set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare v_gente json; v_celdas json;
begin
  perform _ing(p_dni, p_token);
  if p_hasta < p_desde then return json_build_object('ok',false,'error','Rango inválido'); end if;
  if (p_hasta - p_desde) > 40 then
    return json_build_object('ok',false,'error','Rango máximo 40 días'); end if;

  with gente as (
    select o.dni, o.nombres_apellidos nombre, o.categoria
      from operarios o
     where o.cargo = 'OPERARIO' and o.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or o.area_origen = p_area)
  ),
  rec as materialized (
    select r.dni, r.fecha, sum(r.minutos) mins, count(*) tk
      from reclamos r
     where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO'
     group by 1,2
  ),
  cons as (
    select c.dni, c.fecha, sum(c.minutos) mins from minutos_consideracion c
     where c.fecha between p_desde and p_hasta group by 1,2
  ),
  ocu as (
    select oc.dni, oc.fecha, sum(oc.minutos) mins from ocurrencias oc
     where oc.fecha between p_desde and p_hasta group by 1,2
  ),
  cel as (
    select g.dni, m.fecha,
           575 + coalesce(o.mins,0) disp,
           coalesce(r.mins,0) + coalesce(cs.mins,0) prod,
           m.pct manual
      from gente g
      join eficiencia_manual m on m.dni = g.dni and m.fecha between p_desde and p_hasta
      left join rec  r  on r.dni  = g.dni and r.fecha  = m.fecha
      left join cons cs on cs.dni = g.dni and cs.fecha = m.fecha
      left join ocu  o  on o.dni  = g.dni and o.fecha  = m.fecha
  )
  select
    (select coalesce(json_agg(json_build_object('dni', dni, 'nombre', nombre,
        'categoria', categoria) order by nombre), '[]'::json) from gente),
    (select coalesce(json_agg(json_build_object(
        'dni', dni, 'fecha', to_char(fecha,'YYYY-MM-DD'), 'manual', manual,
        'ef_tk', case when disp > 0 then round(prod / disp * 100, 1) else null end)), '[]'::json)
     from cel)
    into v_gente, v_celdas;

  return json_build_object('ok', true, 'personas', v_gente, 'celdas', v_celdas);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* La eficiencia que YA tienen por tickets, para poder avisar del resultado al
   escribir a mano. Se pide por rango y área, una sola vez al abrir la rejilla. */
create or replace function public.fn_ef_tickets_rango(
  p_dni text, p_token uuid, p_area text, p_desde date, p_hasta date)
returns json language plpgsql security definer set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare v json;
begin
  perform _ing(p_dni, p_token);
  if (p_hasta - p_desde) > 40 then
    return json_build_object('ok',false,'error','Rango máximo 40 días'); end if;
  with gente as (
    select o.dni from operarios o
     where o.cargo = 'OPERARIO' and o.estado = 'ACTIVO'
       and (coalesce(p_area,'') = '' or o.area_origen = p_area)
  ),
  rec as (
    select r.dni, r.fecha, sum(r.minutos) mins from reclamos r
     where r.fecha between p_desde and p_hasta and r.estado = 'ACTIVO'
       and r.dni in (select dni from gente) group by 1,2
  ),
  cons as (
    select c.dni, c.fecha, sum(c.minutos) mins from minutos_consideracion c
     where c.fecha between p_desde and p_hasta
       and c.dni in (select dni from gente) group by 1,2
  ),
  ocu as (
    select oc.dni, oc.fecha, sum(oc.minutos) mins from ocurrencias oc
     where oc.fecha between p_desde and p_hasta
       and oc.dni in (select dni from gente) group by 1,2
  ),
  base as (
    select coalesce(r.dni, cs.dni) dni, coalesce(r.fecha, cs.fecha) fecha,
           coalesce(r.mins,0) + coalesce(cs.mins,0) prod
      from rec r full join cons cs on cs.dni = r.dni and cs.fecha = r.fecha
  )
  select coalesce(json_agg(json_build_object(
      'dni', b.dni, 'fecha', to_char(b.fecha,'YYYY-MM-DD'),
      'ef', round(b.prod / (575 + coalesce(o.mins,0)) * 100, 1),
      'cons', round(coalesce(cs.mins,0),1))), '[]'::json)
    into v
    from base b
    left join ocu  o  on o.dni  = b.dni and o.fecha  = b.fecha
    left join cons cs on cs.dni = b.dni and cs.fecha = b.fecha
   where (575 + coalesce(o.mins,0)) > 0;
  return json_build_object('ok', true, 'items', v);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* Guardado en lote de la rejilla: [{dni, fecha, pct}]. `pct` nulo BORRA. */
create or replace function public.fn_ef_manual_guardar(
  p_dni text, p_token uuid, p_cambios jsonb)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; c jsonb; v_d text; v_f date; v_pct numeric;
        n_up int := 0; n_del int := 0;
begin
  s := _ing(p_dni, p_token);
  for c in select value from jsonb_array_elements(coalesce(p_cambios,'[]'::jsonb)) loop
    v_d := nullif(trim(coalesce(c->>'dni','')), '');
    v_f := (c->>'fecha')::date;
    if v_d is null or v_f is null then continue; end if;
    v_pct := nullif(trim(coalesce(c->>'pct','')), '')::numeric;
    if v_pct is null then
      delete from eficiencia_manual where dni = v_d and fecha = v_f;
      n_del := n_del + 1;
    else
      insert into eficiencia_manual (dni, fecha, pct, registrado_por)
      values (v_d, v_f, v_pct, s.dni)
      on conflict (dni, fecha) do update
        set pct = excluded.pct, registrado_por = excluded.registrado_por, creado = now();
      n_up := n_up + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'guardados', n_up, 'borrados', n_del);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* ---------- MINUTOS DE CONSIDERACIÓN (CRUD) ---------- */

create or replace function public.fn_consideracion_listar(
  p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text default null)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_area text := nullif(trim(coalesce(p_area,'')), '');
begin
  perform _ing(p_dni, p_token);
  return json_build_object('ok', true, 'items', coalesce((
    select json_agg(json_build_object(
        'id', c.id, 'dni', c.dni, 'nombre', o.nombres_apellidos,
        'area', o.area_origen,
        'fecha', to_char(c.fecha,'YYYY-MM-DD'),
        'minutos', round(c.minutos,1), 'motivo', c.motivo,
        'registrado_por', c.registrado_por,
        'creado', to_char(c.creado at time zone 'America/Lima','YYYY-MM-DD HH24:MI'))
        order by c.fecha desc, o.nombres_apellidos)
      from minutos_consideracion c
      left join operarios o on o.dni = c.dni
     where c.fecha between p_desde and p_hasta
       and (v_area is null or o.area_origen = v_area)), '[]'::json));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* `p_id` nulo crea; con id edita. Los minutos pueden ser negativos: también sirve
   para descontar algo que se cargó de más. */
create or replace function public.fn_consideracion_guardar(
  p_dni text, p_token uuid, p_id bigint, p_dni_op text, p_fecha date,
  p_minutos numeric, p_motivo text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios; v_id bigint;
begin
  s := _ing(p_dni, p_token);
  if coalesce(trim(p_dni_op),'') = '' or p_fecha is null then
    return json_build_object('ok', false, 'error', 'Persona y fecha son obligatorias');
  end if;
  if coalesce(p_minutos,0) = 0 then
    return json_build_object('ok', false, 'error', 'Los minutos no pueden ser cero');
  end if;
  if not exists (select 1 from operarios where dni = p_dni_op) then
    return json_build_object('ok', false, 'error', 'No existe esa persona');
  end if;
  if p_id is null then
    insert into minutos_consideracion (dni, fecha, minutos, motivo, registrado_por)
    values (trim(p_dni_op), p_fecha, p_minutos, nullif(trim(coalesce(p_motivo,'')),''), s.dni)
    returning id into v_id;
  else
    update minutos_consideracion
       set dni = trim(p_dni_op), fecha = p_fecha, minutos = p_minutos,
           motivo = nullif(trim(coalesce(p_motivo,'')),''), registrado_por = s.dni
     where id = p_id
    returning id into v_id;
    if v_id is null then return json_build_object('ok', false, 'error', 'No existe esa línea'); end if;
  end if;
  return json_build_object('ok', true, 'id', v_id);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_consideracion_eliminar(
  p_dni text, p_token uuid, p_id bigint)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  perform _ing(p_dni, p_token);
  delete from minutos_consideracion where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('ok', false, 'error', 'No existe esa línea'); end if;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

notify pgrst, 'reload schema';
