-- PARCHE 133 — Personal: estructura por mes (quién es de cada área, MOD/MOI, ingresos y bajas)
-- La estructura del mes nace en Personal. Cada fila = una persona en ese mes: su área OFICIAL (distinta del
-- área donde hoy apoya), tipo MOD/MOI, cargo de la estructura, fecha de ingreso y de baja. Incluye personal
-- que no está en el sistema (liquidación, tizadores, jefes).
-- 1) estructura_mes: tabla, con el mismo control de permisos por área que las demás.
-- 2) Trigger en operarios: un ingreso nuevo entra a la estructura del mes con su fecha; pasar a INACTIVO pone
--    la fecha de baja (y reactivar la quita). Solo toca el mes en curso.
-- 3) fn_estructura_mes (lectura), fn_estructura_guardar, fn_estructura_quitar y fn_estructura_copiar
--    (trae del mes anterior a quien sigue). No se toca ninguna RPC existente.
-- 4) Estructura de octubre 2026 cargada desde el Excel de inicio de mes, más quienes ingresaron después.
-- Rollback: parche_133_rollback.sql
begin;

create table if not exists public.estructura_mes (
  mes date not null check (extract(day from mes) = 1),
  dni text not null,
  nombre text not null,
  area text not null,
  subarea text,
  tipo text not null check (tipo in ('MOD','MOI')),
  cargo text,
  desde date,
  hasta date,
  nota text,
  actualizado timestamptz not null default now(),
  actualizado_por text,
  primary key (mes, dni),
  check (desde is null or hasta is null or desde <= hasta)
);
comment on table public.estructura_mes is 'Estructura de personal por mes. area = área oficial; subarea (p. ej. ACABADO - CAMISA); desde/hasta = ingreso y baja dentro o antes del mes.';
create index if not exists estructura_mes_area_idx on public.estructura_mes (mes, area);
alter table public.estructura_mes enable row level security;
revoke all on public.estructura_mes from anon, authenticated;
drop trigger if exists perm_area_trg on public.estructura_mes;
create trigger perm_area_trg after insert or delete or update on public.estructura_mes
  for each row when (current_setting('app.perm', true) like '|%')
  execute function _perm_area_trg('area');

create or replace function public._estructura_sync()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_mes date := date_trunc('month', _hoy())::date;
begin
  if tg_op = 'INSERT' then
    if new.cargo in ('OPERARIO','SUPERVISORA') and new.estado = 'ACTIVO' then
      insert into estructura_mes (mes, dni, nombre, area, tipo, cargo, desde, actualizado_por)
      values (v_mes, new.dni, new.nombres_apellidos, coalesce(new.area_origen, new.area_actual),
              case when new.cargo = 'SUPERVISORA' then 'MOI' else 'MOD' end,
              case when new.cargo = 'SUPERVISORA' then 'SUPERVISOR' end, _hoy(), 'auto')
      on conflict (mes, dni) do nothing;
    end if;
  elsif new.estado is distinct from old.estado then
    if new.estado = 'ACTIVO' then
      update estructura_mes set hasta = null where mes = v_mes and dni = new.dni;
    else
      update estructura_mes set hasta = coalesce(hasta, _hoy()) where mes = v_mes and dni = new.dni;
    end if;
  end if;
  return null;
end $function$;
drop trigger if exists estructura_sync_trg on public.operarios;
create trigger estructura_sync_trg after insert or update of estado on public.operarios
  for each row execute function _estructura_sync();

create or replace function public.fn_estructura_mes(p_dni text, p_token uuid, p_mes date, p_area text default '')
 returns json language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date; v_fin date; v_filas json; v_faltan json; v_meses json;
begin
  perform _lector(p_dni, p_token, p_area);
  v_fin := (v_mes + interval '1 month - 1 day')::date;

  select json_agg(json_build_object(
      'dni', e.dni, 'nombre', e.nombre, 'area', e.area, 'subarea', e.subarea, 'tipo', e.tipo, 'cargo', e.cargo,
      'desde', e.desde, 'hasta', e.hasta, 'nota', e.nota,
      'en_sistema', o.dni is not null, 'estado_bd', o.estado, 'area_actual', o.area_actual,
      'movs', (select json_agg(json_build_object('fecha', m.fecha, 'de', m.area_anterior, 'a', m.area_nueva) order by m.fecha, m.id)
                 from movimientos_area m where m.dni = e.dni and m.fecha between v_mes and v_fin))
    order by e.area, coalesce(e.subarea, ''), case e.tipo when 'MOD' then 0 else 1 end, e.nombre)
    into v_filas
  from estructura_mes e left join operarios o on o.dni = e.dni
  where e.mes = v_mes and (coalesce(p_area, '') = '' or e.area = p_area);

  select json_agg(json_build_object('dni', o.dni, 'nombre', o.nombres_apellidos, 'area', coalesce(o.area_origen, o.area_actual), 'cargo', o.cargo)
                  order by o.area_origen, o.nombres_apellidos)
    into v_faltan
  from operarios o
  where o.estado = 'ACTIVO' and o.cargo in ('OPERARIO','SUPERVISORA')
    and (coalesce(p_area, '') = '' or coalesce(o.area_origen, o.area_actual) = p_area)
    and v_mes = date_trunc('month', _hoy())::date
    and not exists (select 1 from estructura_mes e where e.mes = v_mes and e.dni = o.dni);

  select json_agg(to_char(m, 'YYYY-MM-DD') order by m desc) into v_meses from (select distinct mes m from estructura_mes) z;

  return json_build_object('ok', true, 'mes', to_char(v_mes, 'YYYY-MM-DD'),
    'filas', coalesce(v_filas, '[]'::json), 'sin_estructura', coalesce(v_faltan, '[]'::json),
    'meses', coalesce(v_meses, '[]'::json),
    'hay_anterior', exists (select 1 from estructura_mes where mes = (v_mes - interval '1 month')::date));
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_estructura_guardar(p_dni_ing text, p_token text, p_mes date, p_dni text, p_nombre text,
    p_area text, p_subarea text, p_tipo text, p_cargo text, p_desde date, p_hasta date, p_nota text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_mes date := date_trunc('month', coalesce(p_mes, _hoy()))::date;
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);
  if coalesce(trim(p_dni), '') = '' or coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_area), '') = '' then
    return json_build_object('ok', false, 'error', 'DNI, nombre y área son obligatorios');
  end if;
  if p_tipo not in ('MOD','MOI') then return json_build_object('ok', false, 'error', 'Tipo debe ser MOD o MOI'); end if;
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    return json_build_object('ok', false, 'error', 'La baja no puede ser antes del ingreso');
  end if;
  insert into estructura_mes (mes, dni, nombre, area, subarea, tipo, cargo, desde, hasta, nota, actualizado, actualizado_por)
  values (v_mes, upper(trim(p_dni)), upper(trim(p_nombre)), upper(trim(p_area)), nullif(upper(trim(coalesce(p_subarea,''))), ''), p_tipo,
          nullif(upper(trim(coalesce(p_cargo,''))), ''), p_desde, p_hasta, nullif(trim(coalesce(p_nota,'')), ''), now(), p_dni_ing)
  on conflict (mes, dni) do update set nombre = excluded.nombre, area = excluded.area, subarea = excluded.subarea,
    tipo = excluded.tipo, cargo = excluded.cargo, desde = excluded.desde, hasta = excluded.hasta, nota = excluded.nota,
    actualizado = now(), actualizado_por = excluded.actualizado_por;
  return json_build_object('ok', true);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_estructura_quitar(p_dni_ing text, p_token text, p_mes date, p_dni text)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_n int;
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);
  delete from estructura_mes where mes = date_trunc('month', p_mes)::date and dni = p_dni;
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'quitados', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.fn_estructura_copiar(p_dni_ing text, p_token text, p_mes date)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v_mes date := date_trunc('month', p_mes)::date; v_n int;
begin
  perform fn_validar_ingenieria(p_dni_ing, p_token);
  insert into estructura_mes (mes, dni, nombre, area, subarea, tipo, cargo, actualizado_por)
  select v_mes, e.dni, e.nombre, e.area, e.subarea, e.tipo, e.cargo, p_dni_ing
    from estructura_mes e
   where e.mes = (v_mes - interval '1 month')::date and e.hasta is null
     and not exists (select 1 from operarios o where o.dni = e.dni and o.estado <> 'ACTIVO')
  on conflict (mes, dni) do nothing;
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'copiados', v_n);
exception when others then
  if SQLERRM like '%SESION_INVALIDA%' or SQLERRM like '%NO_AUTORIZADA%' then raise; end if;
  return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

grant execute on function public.fn_estructura_mes(text, uuid, date, text) to anon, authenticated;
grant execute on function public.fn_estructura_guardar(text, text, date, text, text, text, text, text, text, date, date, text) to anon, authenticated;
grant execute on function public.fn_estructura_quitar(text, text, date, text) to anon, authenticated;
grant execute on function public.fn_estructura_copiar(text, text, date) to anon, authenticated;

-- Estructura de octubre 2026 (Excel de inicio de mes).
insert into public.estructura_mes (mes, dni, nombre, area, subarea, tipo, cargo, actualizado_por)
select '2026-10-01', v.dni, v.nombre, v.area, v.subarea, v.tipo, v.cargo, 'excel'
from (values
  ('06219925','CANAZA PACHARI, JUANA','ACABADO',null,'MOI','SUPERVISOR'),
  ('03373129','CASTRO AGUIRRE, MARITZA ELENA','ACABADO','CAMISA','MOD','PLANCHADOR'),
  ('70548505','CHAVEZ QUISPE, LUIS ANGEL','ACABADO','CAMISA','MOD','PLANCHADOR'),
  ('09263365','CHOQUE MARTINEZ, ROSA FELICITAS','ACABADO','CAMISA','MOD','MANUAL'),
  ('41134878','CORTEZ VASQUEZ, EVELINA JESSICA','ACABADO','CAMISA','MOD','PLANCHADOR'),
  ('60898507','GONZALES AQUINO, GENESIS MARIACIELO','ACABADO','CAMISA','MOD','MANUAL'),
  ('09336046','HUAMANI CRUZ, OLGA LIDIA','ACABADO','CAMISA','MOD','MANUAL'),
  ('47475063','HUAPAYA BLAS, MARISOL ROSEMARY','ACABADO','CAMISA','MOD','MANUAL'),
  ('74105276','LUQUE RIVAS, DANNA ALESSANDRA','ACABADO','CAMISA','MOD','PLANCHADOR'),
  ('45305083','ORTIZ TITO, YHENI MAYRA','ACABADO','CAMISA','MOD','PLANCHADOR'),
  ('25711410','PEREZ FLORES, ISABEL CRISTINA','ACABADO','CAMISA','MOD','MANUAL'),
  ('10009183','QUISPE QUISPE, HIPOLITA','ACABADO','CAMISA','MOD','MANUAL'),
  ('40284928','APAZA MAMANI, ERIK JAVIER','ACABADO','PANTALÓN','MOD','PLANCHADOR'),
  ('80255518','RIVERA MARTINEZ, GABRIELA CRISTINA','ACABADO','PANTALÓN','MOD','MANUAL'),
  ('42471860','ROJAS RAMIREZ, JIMMY JHON','ACABADO','PANTALÓN','MOD','PLANCHADOR'),
  ('42846725','TIQUILLAHUANCA BERNA, LEONARDO','ACABADO','PANTALÓN','MOD','PLANCHADOR'),
  ('80054180','AGUILAR GONZAGA, EDUARDO JOSE','ACABADO','SACO','MOD','PLANCHADOR'),
  ('25846240','ARIAS CHUMPITAZ, VIVIANA BETTY','ACABADO','SACO','MOD','MANUAL'),
  ('76317029','BALLADARES CARRASCO, YESSER SMITH','ACABADO','SACO','MOD','PLANCHADOR'),
  ('43786646','FERNANDEZ NUÑEZ, GILBERTO','ACABADO','SACO','MOD','PLANCHADOR'),
  ('10594746','PRADERA ALCOCER, GERMAN ALEJANDRO','ACABADO','SACO','MOD','PLANCHADOR'),
  ('08356265','BELLIDO RIOS, ANA MARIA','CAMISA COSTURA',null,'MOD','HABILITADOR'),
  ('71708915','CABALLERO CATALAN, ROBERTO WILLIAN','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('40434837','CALVO SANCHEZ, MARCELINO RAFAHEL','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('70172887','CAYLLAHUA GUTIERREZ, VIEDMA','CAMISA COSTURA',null,'MOD','MANUAL'),
  ('41012051','CESIAS SAAVEDRA, AUDELIA','CAMISA COSTURA',null,'MOD','MANUAL'),
  ('40493039','CHANTA RODRIGUEZ, ELIT PAOLA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('09346629','CUEVA HUAMANI, ROSA AMELIA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('78887098','DE LA CRUZ ONDRE, YOSELY SOFIA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('40823473','DEL AGUILA ACUÑA, PEPE','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('42555265','DEL AGUILA FACHIN, RUTH IRIS','CAMISA COSTURA',null,'MOD','MANUAL'),
  ('75595650','DEL CASTILLO PALOMINO, VERANIA ELOISA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('10166064','ESPELETA PAREDES, SANTOS LUISA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('08888241','ESPINOZA MIRANDA, GLORIA MARIA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('76744360','FERNANDEZ MANAY, LILI JANETH','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('45676005','FERRO PUMA, JANET LOURDES','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('09290814','GUTIERREZ HUAMAN, SUSYBELL YOVANA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('10354763','HUALLANCA CASTILLO, GLADYS GIOVANNA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('10527369','HUAMAN BALANDA, CONCEPCION','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('09113708','HUAMAN ESPINOZA, FLORENTINO PEDRO','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('10652269','LAURENTE HUAYANAY, CARMEN ELIZABETH','CAMISA COSTURA',null,'MOD','MANUAL'),
  ('10752298','LIZARRAGA MAMANI, LILI LAURA','CAMISA COSTURA',null,'MOD','PLANCHADOR'),
  ('42330035','LLAUCE LLONTOP, FELICITA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('21508993','LLONTOP CARPIO, MILAGROS LUISA','CAMISA COSTURA',null,'MOD','MANUAL'),
  ('08636641','MARIN GONZALES, ISABEL','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('10161369','MONTENEGRO SOTO, JESSICA ROXANA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('07636773','MONTES ALVA, MARIA ELENA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('44369170','NUÑEZ PINEDO, ESTELA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('42941962','OCHOA MELCHOR, GISELLA VERONICA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('09822234','OROZCO URBINA, ANA MARÍA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('09716721','PALOMINO ARMAS, MIRTHA BEATRIZ','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('09134370','PANCHE PRIETO, ODOÑA SANTOSA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('42354688','QUISPE AYALA, MARIA ELIZABETH','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('03669563','REQUENA LOAYZA DE HERRERA, CARMEN ELISA','CAMISA COSTURA',null,'MOD','PLANCHADOR'),
  ('44108959','SALAZAR AYALA, NORMA','CAMISA COSTURA',null,'MOD','MANUAL'),
  ('41882076','SANCHEZ SANDOVAL, ARACELI','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('70919930','SORIANO EGUILUZ ANDREA SOLANGE','CAMISA COSTURA',null,'MOD','MANUAL'),
  ('07640328','TIMOTEO PINEDA, MERCEDES VERONICA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('06666940','VALDIVIA SARMIENTO, ABDON','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('09696303','VASQUEZ BURGA, ERVES','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('42656056','VELASQUEZ POMA, ARACELI SOLEDAD','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('10162718','VILCA CASTAÑEDA, CLEMIRA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('45894211','WINCHONLONG ANCAJIMA, JOHANA','CAMISA COSTURA',null,'MOD','COSTURERO'),
  ('08471322','LOPEZ DOMINGUEZ, MARIA ELENA','CAMISA COSTURA',null,'MOI','SUPERVISOR'),
  ('10584850','ALCANTARA VARGAS, JULIO CESAR','CORTE',null,'MOD','CORTADOR'),
  ('40174027','ALEJANDRO SONCCO, PERCY CARLOS','CORTE',null,'MOD','NUMERADOR'),
  ('71739811','CHOTA SIÑOS, ANTHONY ULISES','CORTE',null,'MOD','TENDEDOR'),
  ('10014908','CRUZ CHINCHAY, SANTOS VIRGINIA','CORTE',null,'MOD','PRETINA'),
  ('42843654','DELGADO VARGAS, ROCIO ELIZABETH','CORTE',null,'MOD','NUMERADOR'),
  ('44488882','FASABI MARICHI, ROLIANITH','CORTE',null,'MOD','FUSIONADO'),
  ('72872173','GARRIDO BENDITA, JONATHAN ANDRES','CORTE',null,'MOD','TENDEDOR'),
  ('71519685','GIL TICLLA, FANY','CORTE',null,'MOD','FUSIONADO'),
  ('75751444','HERRERA LUQUE, CARLOS','CORTE',null,'MOD','AYUDANTE'),
  ('09527815','HUAYANAY RISPA, TRINIDAD VIRGINIA','CORTE',null,'MOD','HABILITADOR'),
  ('10075276','INGAROCA RAMIREZ, EDITH ARLENE','CORTE',null,'MOD','FUSIONADO'),
  ('44797146','MORE COVEÑAS, MARIA FLORINDA','CORTE',null,'MOD','FUSIONADO'),
  ('70663036','MORE MENDOZA ERIKA YAMILE','CORTE',null,'MOD','NUMERADOR'),
  ('09947639','POLO GOMEZ, MARIA GIOVANNA','CORTE',null,'MOD','NUMERADOR'),
  ('43586326','REVETTA VERGARA VIRGINIA CRISTEL','CORTE',null,'MOD','FUSIONADO'),
  ('72686956','ROJAS MARTEL, JOSE RICARDO','CORTE',null,'MOD','TENDEDOR'),
  ('47144807','SANCHEZ QUISPE, CRISTIAN MIGUEL','CORTE',null,'MOD','TENDEDOR'),
  ('47702366','TOMAYLLA PUJAICO, DORIS','CORTE',null,'MOD','NUMERADOR'),
  ('44840543','TONGO CORREA, MARIA AYDE','CORTE',null,'MOD','FUSIONADO'),
  ('73583064','TORRES DIAZ, DORALIZA','CORTE',null,'MOD','NUMERADOR'),
  ('09718582','YABARRENA TABOADA, SARA BEATRIZ','CORTE',null,'MOD','FUSIONADO'),
  ('41191415','LARA QUISPE, JART','CORTE',null,'MOI','JEFE'),
  ('42935604','PACHECO VEGA CARMEN ROSA','CORTE',null,'MOI','LIQUIDADOR'),
  ('40428684','REYES GARCIA, CHRIST ADAN POLY','CORTE',null,'MOI','TIZADOR'),
  ('08593185','RIOS ROMERO, FERNANDO FELIPE','CORTE',null,'MOI','TIZADOR'),
  ('75800617','DE LA CRUZ PAIVA, ALEXANDRA','LIQUIDACION',null,'MOI','LIQUIDADORA'),
  ('09642288','LOPEZ CARBAJAL, LUIS GUSTAVO','LIQUIDACION',null,'MOI','MANUAL'),
  ('61470717','SANGAMA RAMIREZ, DIEGO ARMANDO','LIQUIDACION',null,'MOI','MANUAL'),
  ('61194401','TAPAYURI LOMAS, FERNANDO','LIQUIDACION',null,'MOI','MANUAL'),
  ('41780686','ACHO ESPINOZA, VIVIANA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('46631172','ACUÑA CARMONA, MAGDALENA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('45627218','ANDY MURAYARI, ROSA MARGARITA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('40906685','AYALA HUARCAYA, KARI PAMELA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('06077515','CASTILLO MEJIA, NOEMI ROSARIO','PANTALON COSTURA',null,'MOD','MANUAL'),
  ('10236620','DIAZ MORALES, LOURDES DEL ROSARIO','PANTALON COSTURA',null,'MOD','MANUAL'),
  ('10863929','GUARNIZ CASTAGNE VDA DE CRUZ, MILAGROS ALEJANDRA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('09314156','GUIZADO CANCHUMAYA, MARIA DEL CARMEN','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('07267942','HUAMAN MENDOZA DE RAMIREZ, VIRGINIA SILVIA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('10537218','HUAMAN ROJAS, MAGALY','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('41802349','HUIHUA CHIPANA JOSE CARLOS','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('47707808','ISUIZA SATALAYA, RUTH GIANINA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('09831630','JORGE LEON, CARMEN ROSA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('10326595','JORGE LEON, EDITH','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('47700901','LLANQUE PINTO, YESSENIA MARLENE','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('47535764','LOPEZ NATORCE VANESA ASTRITH','PANTALON COSTURA',null,'MOD','MANUAL'),
  ('73219861','MACEDO CRUZ, ROSA ANABEL','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('09927782','MORALES DE LA CRUZ, JOSE LUIS','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('08916682','MORON CHIRINOS, ROBERTA DAMIANA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('75565823','NAPAN APAZA, FLOR DE MARIA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('42690483','NATORCE MOENA, SARA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('41665244','OLIVERIA LOPEZ, JOSELINO','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('43011202','PENADILLO TUMPAY, DANIEL ALEXANDER','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('75194116','PINEDA ESCOBAR MARI CRUZ','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('41756080','PINTADO BERRU, MARGOT','PANTALON COSTURA',null,'MOD','MANUAL'),
  ('43429513','PUELLES YNOÑAN, ROSA MILAGROS','PANTALON COSTURA',null,'MOD','HABILITADOR'),
  ('10443771','RAMIREZ AUCCA, ROSA MARIA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('09823920','RAYME SULCA, JUSTINA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('41347984','REYES LUERA, JORGE LUIS','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('46336028','RICSE VEGA, YODITA','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('40894512','SALAZAR ZAPATA, EDIN','PANTALON COSTURA',null,'MOD','MANUAL'),
  ('10347959','SALCEDO CHINININ, FRANCIA ISABEL','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('46174608','SANTISTEBAN ISASI, SILVANA DEL PILAR','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('45886068','TECCO BOCANEGRA, FIORI CELESTE','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('44147616','TRIBIÑOS POMA, MIRIAM','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('09681892','VICHARRA LOPEZ, WALTER RAUL','PANTALON COSTURA',null,'MOD','COSTURERO'),
  ('33590315','ZAPATA CHUNGA, CRISTINA','PANTALON COSTURA',null,'MOD','MANUAL'),
  ('42526235','VALDERA SANCHEZ, DORIS MEDALIT','PANTALON COSTURA',null,'MOI','SUPERVISOR'),
  ('71618397','CAHUA CHANTA, GABRIEL ANTONIO','REPROCESO',null,'MOD','FLEXIBLE'),
  ('75358045','CCUNO COJOMA, ANA ANDREA','REPROCESO',null,'MOD','MANUAL'),
  ('05357233','CRUZ TORRES, MAGDALENA','REPROCESO',null,'MOD','MANUAL'),
  ('41301931','ERIKA MILAGROS MADUEÑO CANGRE','REPROCESO',null,'MOD','MANUAL'),
  ('40340311','GOMEZ MALMA, LUZ JANETH','REPROCESO',null,'MOD','MANUAL'),
  ('41416479','NAUPARI FRANCISCO, MARITZA ROCIO','REPROCESO',null,'MOD','MANUAL'),
  ('01154520','ZURITA MAURIOLA, VICKY ALEGRIA','REPROCESO',null,'MOD','MANUAL'),
  ('48476180','ANDY MURAYARI, NATALIA','SACO COSTURA',null,'MOD','MANUAL'),
  ('47011903','AYVAR BORDA, GIOVANNA EMPERATRIZ','SACO COSTURA',null,'MOD','COSTURERO'),
  ('40850261','BERROCAL ARANGO, VIOLETA ROCIO','SACO COSTURA',null,'MOD','COSTURERO'),
  ('76339100','CAHUANA QUISPE, MARTHA ESTEFANI','SACO COSTURA',null,'MOD','MANUAL'),
  ('02454176','CASTILLO MOYA, YASMIN ARELYS','SACO COSTURA',null,'MOD','COSTURERO'),
  ('20665966','CHUQUICHAICO DAMIAN, MARIO','SACO COSTURA',null,'MOD','COSTURERO'),
  ('74905298','CUELLO VARGAS, YERIKA MILAGROS','SACO COSTURA',null,'MOD','COSTURERO'),
  ('41825204','DOMINGUEZ CORDOVA, MARGARITA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('09700912','DURAND MARCOS, MARIA ISABEL','SACO COSTURA',null,'MOD','MANUAL'),
  ('21787113','FELIX ATUNCAR, MARIA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('42775575','FLORIAN VELASQUEZ JESSICA MARIA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('09694373','INGA FLORES, VERONICA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('76798697','JIMENEZ TORRES, MAYESLI RUTH','SACO COSTURA',null,'MOD','MANUAL'),
  ('08889059','LLATA RICCI, LILIANA TERESA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('40816984','LOPEZ VARGAS, REYNA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('05491633','LOVERA DIAZ, NAICARETH JOSELYN','SACO COSTURA',null,'MOD','MANUAL'),
  ('08176888','MATIAS CONTRERAS, SONIA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('41620543','MEDINA CHAVEZ, NELLY ESMERITA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('44265614','NUÑEZ PINEDO, ARELA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('41288323','ORTIZ CUÑE, NANCY MAGALY','SACO COSTURA',null,'MOD','MANUAL'),
  ('45994686','ORTIZ VILCAPAZA, FLOR CANDIDA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('42995884','PILLACA HUAMANI, ROSA','SACO COSTURA',null,'MOD','MANUAL'),
  ('41404486','POLANCO ESPINOZA, RUTH NOEMI','SACO COSTURA',null,'MOD','COSTURERO'),
  ('76067912','QUISPE SOTAYA, EVELYN NORVY','SACO COSTURA',null,'MOD','COSTURERO'),
  ('09655196','RODRIGUEZ FLORIANO, SANTOS EDGAR','SACO COSTURA',null,'MOD','COSTURERO'),
  ('10585326','ROJAS CARRANZA, ELVIRA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('46265511','SEMINARIO TIPIANA, CANDY MELISSA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('40150363','TANTALEAN RENGIFO, JULISSA','SACO COSTURA',null,'MOD','COSTURERO'),
  ('41119089','VASQUEZ DIEGUEZ, JOSE LUIS','SACO COSTURA',null,'MOD','COSTURERO'),
  ('41866883','VILLAVICENCIO BUSTAMANTE, CARLOS RUDY','SACO COSTURA',null,'MOD','COSTURERO'),
  ('42105643','DEL AGUILA MALLQUI, ANA VICTORIA','SACO COSTURA',null,'MOI','SUPERVISOR'),
  ('08951640','FLORES ARIAS, SONIA DOMINICA','UDP',null,'MOD','MANUAL'),
  ('40940909','TORPOCO SANTIAGO, MILAGROS ELIZABETH','UDP',null,'MOD','MANUAL')
) v(dni, nombre, area, subarea, tipo, cargo)
on conflict (mes, dni) do nothing;

-- Quienes están activos en el sistema pero no venían en el Excel: ingresaron después del inicio de mes.
insert into public.estructura_mes (mes, dni, nombre, area, tipo, cargo, nota, actualizado_por)
select '2026-10-01', o.dni, o.nombres_apellidos, coalesce(o.area_origen, o.area_actual),
       case when o.cargo = 'SUPERVISORA' then 'MOI' else 'MOD' end,
       case when o.cargo = 'SUPERVISORA' then 'SUPERVISOR' end,
       'Ingresó después del Excel de inicio de mes: completar la fecha de ingreso', 'alta'
from public.operarios o
where o.estado = 'ACTIVO' and o.cargo in ('OPERARIO','SUPERVISORA')
  and not exists (select 1 from public.estructura_mes e where e.mes = '2026-10-01' and e.dni = o.dni);

-- Quienes venían en el Excel y ya están inactivos: se fueron durante el mes. La baja se toma de su último ticket.
update public.estructura_mes e
   set hasta = (select max(r.fecha) from public.reclamos r where r.dni = e.dni and r.fecha >= '2026-10-01' and r.estado = 'ACTIVO'),
       nota = 'Baja durante el mes: confirmar la fecha'
  from public.operarios o
 where e.mes = '2026-10-01' and o.dni = e.dni and o.estado <> 'ACTIVO';

commit;
