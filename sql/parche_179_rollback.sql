-- ROLLBACK PARCHE 179: vuelve a crear las 4 funciones. Correr, en este orden, el contenido de
-- sql/parche_172.sql (crea _habil, fn_pcp_calendario y fn_pcp_dia_cambiar; la tabla dias_habilitados ya existe) y sql/parche_173.sql (fn_pcp_calendario_areas).
select 'Reaplicar parche_172.sql y parche_173.sql' as pendiente;
