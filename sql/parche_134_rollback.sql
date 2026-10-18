begin;
drop function if exists public.fn_ofs_completar_varias(text, uuid, jsonb, boolean);
drop function if exists public.fn_ofs_completadas(text, uuid, text);
commit;
