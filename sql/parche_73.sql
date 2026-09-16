-- PARCHE 73 — El modular es del área ACTUAL, se puede forzar a mano, y el área
-- de INGENIERIA queda fuera de todo.
--
-- 1. ÁREA DEL MODULAR
--    El bono modular premia el esfuerzo del área en el día, así que le toca al
--    área donde la persona TRABAJA: si es de ACABADO pero está prestada a CAMISA
--    COSTURA, cobra el modular de CAMISA COSTURA, que es al que aportó. Agrupar
--    sigue siendo por área de ORIGEN (parche 71): son dos preguntas distintas.
--
-- 2. OVERRIDE MANUAL
--    Un botón por persona en la quincena. Sin fila manda la regla del 70%;
--    forzado sí lo paga igual; forzado no lo anula. Forzarlo levanta esa puerta,
--    NO el descuento por día: se siguen pagando solo los días en que la persona
--    tuvo porcentaje. El rango va en la PK porque el override es de ESA quincena.
--
-- 3. INGENIERIA
--    No es un área de planta: no se supervisa ni entra en bonificaciones. Se
--    colaba en TODOS los selectores porque `fn_areas_listar` saca las áreas de
--    `operarios`, y los cuatro usuarios de ingeniería tienen area_actual =
--    'INGENIERIA'. `areas_config` nunca la tuvo.

create or replace function public.fn_areas_listar(p_dni text, p_token uuid)
returns json language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform _auth(p_dni, p_token);
  return coalesce((
    select json_agg(distinct a order by a)
    from (
      select area_actual as a from operarios where area_actual is not null
      union
      select area_origen as a from operarios where area_origen is not null
    ) t
    where a <> 'INGENIERIA'
  ), '[]'::json);
end $function$;

/* Forzar o quitar el modular a una persona en una quincena concreta. Sin fila,
   manda la regla del 70%. El rango va en la PK porque el override es de ESA
   quincena: la siguiente vuelve a decidirse sola. */
create table if not exists bono_modular_override (
  dni            text not null,
  desde          date not null,
  hasta          date not null,
  forzar         boolean not null,
  registrado_por text,
  creado         timestamptz not null default now(),
  primary key (dni, desde, hasta)
);
alter table bono_modular_override enable row level security;

/* `p_forzar` nulo BORRA el override y devuelve la persona al automático. */
create or replace function public.fn_bono_modular_override(
  p_dni text, p_token uuid, p_dni_op text, p_desde date, p_hasta date, p_forzar boolean)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s operarios;
begin
  s := _ing(p_dni, p_token);
  if coalesce(trim(p_dni_op),'') = '' or p_desde is null or p_hasta is null then
    return json_build_object('ok', false, 'error', 'Faltan persona o rango');
  end if;
  if p_forzar is null then
    delete from bono_modular_override
     where dni = trim(p_dni_op) and desde = p_desde and hasta = p_hasta;
    return json_build_object('ok', true, 'forzar', null);
  end if;
  insert into bono_modular_override (dni, desde, hasta, forzar, registrado_por)
  values (trim(p_dni_op), p_desde, p_hasta, p_forzar, s.dni)
  on conflict (dni, desde, hasta) do update
    set forzar = excluded.forzar, registrado_por = excluded.registrado_por, creado = now();
  return json_build_object('ok', true, 'forzar', p_forzar);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

/* Seis cambios sobre el cuerpo de `fn_incentivos_quincena` que dejó el parche 72.
   Se aplican por SUSTITUCIÓN sobre lo que ya está en la base, en vez de retipear
   las 250 líneas: así el resultado no puede divergir de lo desplegado, y si
   algún fragmento no aparece la migración falla en vez de dejarlo a medias. */
do $mig$
declare src text; nuevo text; i int;
  pares text[][] := array[
    array[
'    select o.dni, o.nombres_apellidos nombre, o.area_origen area_base, o.categoria,
           (o.estado <> ''ACTIVO'') cesado
    from operarios o
    where (coalesce(p_area,'''') = '''' or o.area_origen = p_area)
      and o.cargo = ''OPERARIO''',
'    select o.dni, o.nombres_apellidos nombre, o.area_origen area_base,
           /* El bono modular es del área donde la persona TRABAJA hoy: si es de
              ACABADO pero está prestada a CAMISA COSTURA, le toca el modular de
              CAMISA COSTURA, que es al que aportó. Agrupar sigue siendo por
              área de origen (parche 71). */
           o.area_actual area_mod, o.categoria,
           (o.estado <> ''ACTIVO'') cesado
    from operarios o
    where (coalesce(p_area,'''') = '''' or o.area_origen = p_area)
      and o.cargo = ''OPERARIO''
      /* INGENIERIA no es área de planta: no entra en bonificaciones. */
      and coalesce(o.area_origen,'''') <> ''INGENIERIA'''],
    array[
'    select g.dni, g.categoria, g.area_base, d.f, d.idow, d.lunes,',
'    select g.dni, g.categoria, g.area_base, g.area_mod, d.f, d.idow, d.lunes,'],
    array[
'      join mod_dia md on md.area = e.area_base and md.fecha = e.f',
'      join mod_dia md on md.area = e.area_mod and md.fecha = e.f'],
    array[
'  /* El modular solo se paga con promedio de eficiencia >= 70%. */
  modular_final as (
    select g.dni,
           coalesce(pr.prom_ef,0) prom_ef,
           coalesce(mp.soles,0) modular_bruto,
           coalesce(mp.dias,0) modular_dias,
           case when coalesce(pr.prom_ef,0) >= 70 then coalesce(mp.soles,0) else 0 end modular
      from gente g
      left join prom pr on pr.dni = g.dni
      left join modular_persona mp on mp.dni = g.dni
  ),',
'  /* Override manual de la quincena: sin fila, manda la regla del 70%. */
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
  ),'],
    array[
'           coalesce(mf.modular_dias,0) modular_dias
    from gente g',
'           coalesce(mf.modular_dias,0) modular_dias,
           mf.modular_forzado
    from gente g'],
    array[
'        ''modular_dias'', t.modular_dias,',
'        ''modular_dias'', t.modular_dias,
        ''modular_forzado'', t.modular_forzado,']
  ];
begin
  select prosrc into src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'fn_incentivos_quincena';
  nuevo := src;
  for i in 1 .. array_length(pares, 1) loop
    if position(pares[i][1] in nuevo) = 0 then
      raise exception 'no se encontró el fragmento %', i;
    end if;
    nuevo := replace(nuevo, pares[i][1], pares[i][2]);
  end loop;
  execute 'create or replace function public.fn_incentivos_quincena('
       || 'p_dni text, p_token uuid, p_desde date, p_hasta date, p_area text) '
       || 'returns json language plpgsql security definer '
       || 'set search_path to ''public'' set statement_timeout to ''60s'' '
       || 'as $cuerpo$' || nuevo || '$cuerpo$';
end $mig$;

notify pgrst, 'reload schema';
