-- Solo lectura. Reclamos con el DNI cambiado (mismo mapeo que 3_datos_chicos).
-- Se corre por tramos de fechas para que cada resultado quepa; une los tramos en qa/raw/reclamos.json ({cols, rows}).
with m0 as (select dni, row_number() over (order by dni) rn from operarios),
m as (select dni, case when dni ~ '^[0-9]{8}$' then '7'||lpad(rn::text,7,'0') else dni end f from m0)
select json_build_object('cols',json_build_array('id','codigo','dni','area','o_f','modulo','op','std','cant','numeracion','articulo','color','talla','corte','estado','motivo_liberacion','creado','fecha','nop','motivo_fecha','codigo_padre','cant_asignada','op_id','causa','std_base','op_adicional_id'),
'rows',(select json_agg(json_build_array(r.id,r.codigo,m.f,r.area,r.o_f,r.modulo,r.op,r.std,r.cant,r.numeracion,r.articulo,r.color,r.talla,r.corte,r.estado,r.motivo_liberacion,r.creado,r.fecha,r.nop,r.motivo_fecha,r.codigo_padre,r.cant_asignada,r.op_id,r.causa,r.std_base,r.op_adicional_id)) from reclamos r join m using(dni) where r.fecha>=:'desde' and r.fecha<:'hasta')) j;
