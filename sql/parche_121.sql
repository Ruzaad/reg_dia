-- PARCHE 121 — Calidad de BASES (solo lectura)
-- La pantalla Gestión › Calidad de BASES ya está en la app (qa) y llama a
-- fn_bases_calidad, que faltaba en la base. Una sola consulta de lectura:
-- avisos sobre las BASES (registran sin BASE, artículo escrito de dos formas,
-- STD 0, BASE incompleta, OF sin BASE, STD muy distinto, operaciones que
-- nadie registra, total raro) y la cobertura de ACABADO. Nada bloquea.
-- No crea tablas ni cambia funciones existentes. Unos 2 s con todas las áreas.
-- Quién la ve: pestaña Calidad de BASES (o BASES) en Gestión › Permisos; cada
-- quien solo ve los avisos de sus áreas. Rollback: parche_121_rollback.sql.
begin;

create or replace function public.fn_bases_calidad(p_dni text, p_token uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_op operarios; v_areas text[]; v_r jsonb;
begin
  v_op := _vista(p_dni, p_token, array['pasoCalBase','pasoBases']);
  if not coalesce(v_op.es_admin, false)
     and not exists (select 1 from permisos_area where dni = v_op.dni and area = '*') then
    select coalesce(array_agg(area), '{}') into v_areas from permisos_area where dni = v_op.dni;
  end if;
  select x.r into v_r from (
    with
    pm(prenda,area) as (select o.prenda, case when o.prenda in ('CAMISA','BLUSA') then 'CAMISA COSTURA'
       when o.prenda like 'PANTALON%' or o.prenda in ('FALDA','VESTIDO') then 'PANTALON COSTURA' else 'SACO COSTURA' end from (select distinct prenda from ofs) o),
    ofa as (select o.o_f, o.articulo, o.prenda, x.area from ofs o join pm using(prenda) cross join lateral (values (pm.area),('ACABADO')) x(area)),
    rec as (select area, articulo, count(*) n, count(distinct o_f) ofs, round(sum(minutos)) mins from reclamos where estado='ACTIVO' group by 1,2),
    art as (select area, articulo, max(prenda) prenda, count(*) ops, sum(std) total, count(*) filter (where coalesce(std,0)<=0) std0, max(creado)::date subido, string_agg(distinct subido_por,', ') por from bases group by 1,2),
    med as (select area, prenda, count(*) n, percentile_cont(0.5) within group (order by total) mt, percentile_cont(0.5) within group (order by ops) mo from art group by 1,2),
    ofsart as (select articulo, count(*) ofs, sum(cant_prog) pzs from ofs group by 1),
    -- 1 registran sin base
    a1 as (select 'SIN_BASE_REG' tipo, 'grave' nivel, r.area, r.articulo, null::text operacion,
       jsonb_build_object('reclamos',r.n,'ofs',r.ofs,'minutos',r.mins) dato from rec r where r.articulo is not null and not exists (select 1 from bases b where b.area=r.area and b.articulo=r.articulo) and r.area in (select distinct area from bases)),
    -- 2 OF sin base (sin registros todavía)
    a2 as (select 'SIN_BASE_OF' tipo, 'revisar' nivel, f.area, f.articulo, null, jsonb_build_object('ofs',count(*),'lista',jsonb_agg(f.o_f order by f.o_f),'prenda',max(f.prenda)) from ofa f
       where not exists (select 1 from bases b where b.area=f.area and b.articulo=f.articulo) and not exists (select 1 from rec r where r.area=f.area and r.articulo=f.articulo) group by f.area, f.articulo),
    -- 3 STD 0
    a3 as (select 'STD0', case when coalesce(o.ofs,0)>0 then 'grave' else 'revisar' end, a.area, a.articulo, null,
       jsonb_build_object('std0',a.std0,'ops',a.ops,'ofs',coalesce(o.ofs,0),'subido',a.subido,'por',a.por) from art a left join ofsart o using(articulo) where a.std0>0),
    -- 4 incompleta
    a4 as (select 'INCOMPLETA', case when coalesce(o.ofs,0)>0 then 'grave' else 'revisar' end, a.area, a.articulo, null,
       jsonb_build_object('ops',a.ops,'ops_normal',m.mo,'total',round(a.total,2),'total_normal',round(m.mt::numeric,1),'ofs',coalesce(o.ofs,0),'subido',a.subido,'por',a.por)
       from art a join med m using(area,prenda) left join ofsart o using(articulo) where m.n>=5 and a.ops < 0.3*m.mo),
    -- 5 STD raro vs misma operación
    bb as (select area, prenda, articulo, operacion, upper(regexp_replace(trim(operacion),'\s+',' ','g')) op, std from bases where std>0),
    g as (select area, prenda, op, count(distinct articulo) arts, percentile_cont(0.5) within group (order by std) med from bb group by 1,2,3 having count(distinct articulo)>=5),
    a5 as (select 'STD_RARO', 'revisar', bb.area, bb.articulo, bb.operacion,
       jsonb_build_object('std',bb.std,'normal',round(g.med::numeric,2),'veces',round(bb.std/g.med::numeric,1),'arts',g.arts,'ofs',coalesce(o.ofs,0)) from bb join g using(area,prenda,op) left join ofsart o using(articulo)
       where bb.std>3*g.med or bb.std<g.med/3),
    -- 6 nadie registra
    r2 as (select area, o_f, op, sum(cant) c from reclamos where estado='ACTIVO' group by 1,2,3),
    pz as (select area, o_f, max(c) pz from r2 group by 1,2),
    fin as (select o_f from pz where area='ACABADO'),
    j as (select pz.area, pz.o_f, of.articulo, b.operacion, b.std, pz.pz, coalesce(r2.c,0) c from pz join ofs of using(o_f) join bases b on b.articulo=of.articulo and b.area=pz.area
       left join r2 on r2.area=pz.area and r2.o_f=pz.o_f and r2.op=b.operacion where pz.area='ACABADO' or pz.o_f in (select o_f from fin)),
    a6 as (select 'NADIE_REGISTRA', 'revisar', area, string_agg(distinct articulo,', ' order by articulo), upper(operacion),
       jsonb_build_object('ofs',count(*),'arts',count(distinct articulo),'std',round(avg(std),2),'min_base',round(sum(pz*std))) from j group by area, upper(operacion) having sum(c)=0 and count(*)>=3),
    -- 7 total raro
    a7 as (select 'TOTAL_RARO', 'info', a.area, a.articulo, null, jsonb_build_object('total',round(a.total,1),'normal',round(m.mt::numeric,1),'pct',round(a.total/m.mt::numeric*100),'ops',a.ops,'prenda',a.prenda,'ofs',coalesce(o.ofs,0))
       from art a join med m using(area,prenda) left join ofsart o using(articulo) where m.n>=5 and a.ops>=0.3*m.mo and a.std0=0 and (a.total>1.4*m.mt or a.total<0.6*m.mt)),
    a8 as (select 'ARTICULO_PARECIDO', 'grave', max(area), string_agg(distinct articulo, ' / '), null,
       jsonb_build_object('variantes',jsonb_agg(distinct jsonb_build_object('articulo',articulo,'reclamos',n,'ofs',lst))) from (
       select z.k, z.articulo, max(z.area) area, count(*) filter (where z.o_f is not null) n, string_agg(distinct z.o_f, ',') lst from (
         select area, articulo, o_f, translate(upper(regexp_replace(articulo,'\s','','g')),'O','0') k from reclamos where estado='ACTIVO' and articulo is not null
         union all select null, articulo, null, translate(upper(regexp_replace(articulo,'\s','','g')),'O','0') from bases) z group by 1,2) y
       group by k having count(*)>1),
    av as (select * from a1 union all select * from a8 union all select * from a2 union all select * from a3 union all select * from a4 union all select * from a5 union all select * from a6 union all select * from a7),
    -- cobertura ACABADO
    pa as (select o_f, max(c) pz, sum(m) m from (select o_f, op, sum(cant) c, sum(minutos) m from reclamos where estado='ACTIVO' and area='ACABADO' group by 1,2) z group by 1),
    cob as (select of.prenda, sum(pa.pz) pz, round(sum(pa.pz*(select sum(std) from bases b where b.area='ACABADO' and b.articulo=of.articulo))) min_base, round(sum(pa.m)) min_reg
       from pa join ofs of using(o_f) group by 1)
    select jsonb_build_object('ok',true,'generado',now(),
     'areas',(select jsonb_agg(jsonb_build_object('area',x.area,'articulos',x.arts,'ops',x.ops,
        'grave',(select count(*) from av where av.area=x.area and nivel='grave'),'revisar',(select count(*) from av where av.area=x.area and nivel='revisar'),'info',(select count(*) from av where av.area=x.area and nivel='info')) order by x.area)
       from (select area, count(distinct articulo) arts, count(*) ops from bases group by 1) x),
     'sin_base',jsonb_build_array('CORTE','DESPACHO','REPROCESO','UDP'),
     'avisos',(select jsonb_agg(jsonb_build_object('tipo',tipo,'nivel',nivel,'area',area,'articulo',articulo,'operacion',operacion,'dato',dato)) from av),
     'acabado',jsonb_build_object('prendas',(select jsonb_agg(jsonb_build_object('prenda',prenda,'piezas',pz,'min_base',min_base,'min_reg',min_reg,'pct',round(min_reg/nullif(min_base,0)*100)) order by min_base desc) from cob),
       'ops',(select jsonb_agg(t) from (select jsonb_build_object('prenda',b.prenda,'operacion',upper(b.operacion),'ofs',count(*),'std',round(avg(b.std),2),'pct',round(sum(coalesce(r.c,0))/sum(p.pz)*100),'min_falta',round(sum(greatest(p.pz-coalesce(r.c,0),0)*b.std))) t
          from pa p join ofs of using(o_f) join bases b on b.articulo=of.articulo and b.area='ACABADO' left join (select o_f, op, sum(cant) c from reclamos where estado='ACTIVO' and area='ACABADO' group by 1,2) r on r.o_f=p.o_f and r.op=b.operacion
          group by b.prenda, upper(b.operacion) having sum(coalesce(r.c,0))/sum(p.pz)<0.6 order by sum(greatest(p.pz-coalesce(r.c,0),0)*b.std) desc limit 12) q))
    ) r
  ) x;
  if v_areas is not null then
    v_r := v_r || jsonb_build_object(
      'areas',  coalesce((select jsonb_agg(e) from jsonb_array_elements(v_r->'areas') e where e->>'area' = any(v_areas)), '[]'::jsonb),
      'avisos', coalesce((select jsonb_agg(e) from jsonb_array_elements(v_r->'avisos') e where e->>'area' = any(v_areas)), '[]'::jsonb));
    if not ('ACABADO' = any(v_areas)) then v_r := v_r - 'acabado'; end if;
  end if;
  return v_r;
end $function$;
revoke all on function public.fn_bases_calidad(text, uuid) from public;
grant execute on function public.fn_bases_calidad(text, uuid) to anon, authenticated;

commit;
