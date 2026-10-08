-- Solo lectura. Todas las BASES. Guarda {cols, rows} en qa/raw/bases.json
select json_build_object('cols',json_build_array('id','area','prenda','cliente','modulo','articulo','operacion','std','max_op','n_op','subido_por','creado','op_id'),'rows',(select json_agg(json_build_array(id,area,prenda,cliente,modulo,articulo,operacion,std,max_op,n_op,subido_por,creado,op_id) order by id) from bases)) j;
