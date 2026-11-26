-- Vuelve el trigger del parche 91 (los N°OP corregidos se dejan: son los vigentes)
begin;
create or replace function public._reclamo_op_id()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
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
  return new;
end $function$;
commit;
