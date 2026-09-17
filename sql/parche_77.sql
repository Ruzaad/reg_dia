-- PARCHE 77 — La tardanza ya no anula la quincena con una sola
-- 1) Tardanzas: recién anulan a partir de la TERCERA del periodo.
--    Falta y boleta siguen anulando con una sola.
-- 2) El STD pasa a ser un campo configurable de la vista del personal.

-- ---------- 1) REGLA DE PENALIDAD ----------
-- fn_incentivos_quincena son ~200 líneas de CTEs y solo cambian dos
-- expresiones, así que se parchea sobre la definición viva en vez de
-- transcribirla entera (una transcripción mal copiada aquí es plata mal pagada).
-- Es re-ejecutable: si la regla nueva ya está puesta, no hace nada.
do $$
declare d text; viejo text; nuevo text; n int;
begin
  viejo := '(t.faltas + t.tardanzas + t.boleta) > 0';
  nuevo := '((t.faltas + t.boleta) > 0 or t.tardanzas >= 3)';

  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace nn on nn.oid = p.pronamespace
   where nn.nspname = 'public' and p.proname = 'fn_incentivos_quincena';
  if d is null then raise exception 'No existe fn_incentivos_quincena'; end if;

  if position(nuevo in d) > 0 then
    raise notice 'La regla de las 3 tardanzas ya estaba aplicada; no se toca nada.';
    return;
  end if;

  n := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  if n <> 2 then
    raise exception 'Esperaba 2 ocurrencias de la regla de penalidad, encontré %', n;
  end if;

  d := replace(d, '/* Cualquier penalidad anula toda la quincena. */',
                  '/* Falta o boleta anulan la quincena con una sola. La tardanza no:'
                  || ' recién anula a partir de la TERCERA del periodo (parche 77). */');
  d := replace(d, viejo, nuevo);
  execute d;
end $$;

-- ---------- 2) STD CONFIGURABLE ----------
-- Entra APAGADO, que es como quedó en el parche 75.
insert into tickets_visibilidad(campo, visible, orden, etiqueta)
values ('std', false, 0, 'STD (minutos por prenda)')
on conflict (campo) do nothing;
