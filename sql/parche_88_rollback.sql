-- Vuelta atrás del PARCHE 88: solo agrega funciones de lectura.
-- El frontend viejo sigue usando fn_ef_auditoria (parche 80), que no se tocó.
drop function if exists public.fn_ef_auditoria_v2(text, uuid, date, date, text, numeric, numeric);
drop function if exists public.fn_ef_auditoria_ops(text, uuid, text, date);
-- Edge Function: supabase functions delete ef-gemini   (y el secret: supabase secrets unset GEMINI_API_KEY)
