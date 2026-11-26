-- Parche 191 — el N°OP del ticket se corrige solo al reclamar
-- Un ticket de CERRAR HUEQUITO (OF 9874) quedó con N°OP 119 (viejo, del troceo) en vez de 126 y no
-- contaba en la tarjeta de penúltima. El trigger de reclamos ahora toma el N°OP vigente de la BASE.
-- Además corrige los 7 tickets de noviembre ya desfasados (solo la columna nop).
begin;
create or replace function public._reclamo_op_id()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer;
begin
  if new.op_id is null and new.articulo is not null and new.op_adicional_id is null then
    select b.op_id into new.op_id
      from bases b
     where b.area = new.area
       and _nk(b.articulo) = _nk(new.articulo)
       and (_nk(b.operacion) = _nk(new.op) or b.n_op = new.nop)
     order by (case when _nk(b.operacion) = _nk(new.op) then 0 else 1 end), b.id
     limit 1;
  end if;
  -- El N°OP del ticket sigue al de la BASE vigente (el troceo puede traer uno viejo tras una renumeración).
  if new.op_id is not null and new.op_adicional_id is null then
    select b.n_op into v_n from bases b
     where b.op_id = new.op_id and b.area = new.area and b.n_op > 0 and _nk(b.operacion) = _nk(new.op);
    if found and v_n is distinct from new.nop then new.nop := v_n; end if;
  end if;
  return new;
end $function$;

update reclamos r set nop = b.n_op
  from bases b
 where b.op_id = r.op_id
   and r.id in (306980, 306981, 306956, 310578, 330527, 359063, 361590)
   and r.nop is distinct from b.n_op
   and _nk(b.operacion) = _nk(r.op);

select count(*) as quedan_desfasados from reclamos r join bases b on b.op_id = r.op_id
 where r.id in (306980, 306981, 306956, 310578, 330527, 359063, 361590) and r.nop is distinct from b.n_op;
commit;
