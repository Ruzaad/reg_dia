-- ROLLBACK PARCHE 98 · vuelve a `_ausente` como estaba (todo lo que no es ACTIVO).
create or replace function public._ausente(p_estado text)
returns boolean language sql immutable
as $$ select coalesce(p_estado,'ACTIVO') is distinct from 'ACTIVO' $$;
