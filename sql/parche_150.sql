-- PARCHE 150 — Borrar el cargo ESTAJERO (el único estajero era inactivo y sin tickets)
-- Rollback: no aplica (el registro borrado era un usuario inactivo sin movimientos).
begin;
delete from asistencia where dni in (select dni from operarios where cargo = 'ESTAJERO');
delete from movimientos_area where dni in (select dni from operarios where cargo = 'ESTAJERO');
delete from operarios o where o.cargo = 'ESTAJERO' and not exists (select 1 from reclamos r where r.dni = o.dni);
commit;
-- Verificación: select count(*) from operarios where cargo = 'ESTAJERO';  -- debe dar 0
