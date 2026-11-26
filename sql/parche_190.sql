-- Parche 190 — "cannot execute UPDATE in a read-only transaction"
-- Estas 22 funciones estaban marcadas STABLE pero validan la sesión con _auth/_lector, que renueva
-- el token (UPDATE) cuando toca. Dentro de una función STABLE ese UPDATE falla. Pasan a VOLATILE;
-- el cuerpo no cambia.
begin;
alter function public.fn_asistencia_por_confirmar(text, uuid, date, date) volatile;
alter function public.fn_bases_calidad(text, uuid) volatile;
alter function public.fn_buscar(text, uuid, text) volatile;
alter function public.fn_cantidad_penultima(text, uuid, date, date) volatile;
alter function public.fn_dias_no_laborables(text, uuid, date, date) volatile;
alter function public.fn_estructura_mes(text, uuid, date, text) volatile;
alter function public.fn_inicio_prendas(text, uuid, date) volatile;
alter function public.fn_inicio_resumen(text, uuid, date) volatile;
alter function public.fn_mi_meta(text, uuid) volatile;
alter function public.fn_ofs_completadas(text, uuid, text) volatile;
alter function public.fn_pcp_costura(text, uuid, date) volatile;
alter function public.fn_pcp_cronos(text, uuid, date, date) volatile;
alter function public.fn_pcp_cronos_prendas(text, uuid, date, date) volatile;
alter function public.fn_pcp_etapa_detalle(text, uuid, text, text, text) volatile;
alter function public.fn_pcp_etapas(text, uuid, date) volatile;
alter function public.fn_pcp_of_avance(text, uuid, text) volatile;
alter function public.fn_sup_he_lista(text, uuid, text, date) volatile;
alter function public.fn_traza_of(text, uuid, text) volatile;
alter function public.fn_traza_paquete(text, uuid, text, integer) volatile;
alter function public.fn_traza_persona(text, uuid, text) volatile;
alter function public.fn_ultimas_area(text, uuid, text) volatile;
alter function public.fn_ultimas_prenda_area(text, uuid, text) volatile;
commit;
