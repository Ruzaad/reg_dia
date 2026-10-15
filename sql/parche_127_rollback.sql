-- Deshace el parche 127: recrea las tablas vacías y la columna (los datos de la
-- base 9CY740 ya viven en bases desde el 126). Las 3 funciones se dejan como están
-- (no usan estas tablas).
begin;
create table if not exists public.lote_bases (
  id serial primary key, area text not null check (area in ('DESPACHO','REPROCESO')), nombre text not null,
  activo boolean not null default true, creado timestamptz not null default now(), creado_por text not null,
  actualizado timestamptz, actualizado_por text, unique (area, nombre));
create table if not exists public.lote_base_ops (
  id serial primary key, base_id integer not null references public.lote_bases(id), n_op integer not null,
  operacion text not null, std numeric not null check (std > 0 and std <= 600), activo boolean not null default true);
create index if not exists lote_base_ops_base on public.lote_base_ops (base_id, n_op);
alter table public.lotes add column if not exists base_op_id integer references public.lote_base_ops(id);
alter table public.lote_bases enable row level security;
alter table public.lote_base_ops enable row level security;
revoke all on public.lote_bases, public.lote_base_ops from anon, authenticated;
commit;
