-- Solo lectura. Guarda el resultado como qa/raw/funciones.txt
select json_agg(json_build_object('n',p.proname,'d',pg_get_functiondef(p.oid)) order by p.proname, p.oid) f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';
