#!/usr/bin/env python3
"""Comprueba que cada rpc(...) del front exista en Supabase con los mismos
parámetros. PostgREST resuelve por nombre Y por nombres de parámetro: si no
calzan, la función responde 404/400 y la pantalla simplemente no funciona.

Uso:  python3 verificar_enlace.py > /tmp/check.sql
      y pegar el resultado en el SQL Editor de Supabase.
Lo que devuelva la consulta son los PROBLEMAS: si no devuelve filas, todo calza.
"""
import re, sys

ARCHIVOS = ["app.js", "ingenieria.js"]

def llamadas(path):
    s = open(path, encoding="utf-8").read()
    for m in re.finditer(r'rpc\(\s*"([a-zA-Z0-9_]+)"\s*,', s):
        i = s.find("{", m.end())
        if i < 0:
            continue
        d, j = 0, i
        while j < len(s):                      # buscar la llave que cierra
            if s[j] == "{": d += 1
            elif s[j] == "}":
                d -= 1
                if d == 0: break
            j += 1
        cuerpo, claves, prof = s[i+1:j], [], 0
        for k in re.finditer(r'([{}\[\]()])|(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:', cuerpo):
            if k.group(1):
                prof += 1 if k.group(1) in "{[(" else -1
            elif k.group(2) and prof == 0:     # solo claves de primer nivel
                claves.append(k.group(2))
        yield m.group(1), sorted(set(claves)), path

vistas = {}
for f in ARCHIVOS:
    for fn, claves, src in llamadas(f):
        vistas.setdefault((fn, ",".join(claves)), set()).add(src.replace(".js", ""))

filas = ",\n".join(
    "  ('%s','%s','%s')" % (fn, keys, "+".join(sorted(srcs)))
    for (fn, keys), srcs in sorted(vistas.items()))

print(f"-- {len(vistas)} llamadas encontradas en {', '.join(ARCHIVOS)}")
print(f"""with llamadas(fn, keys, origen) as (values
{filas}
), e as (select fn, keys, origen, string_to_array(keys, ',') jskeys from llamadas),
dx as (
  select e.*,
    case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                           where n.nspname='public' and p.proname=e.fn)
           then 'NO EXISTE EN SUPABASE'
         when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and p.proname=e.fn
                         and e.jskeys <@ coalesce(p.proargnames,'{{}}'))
           then 'ok'
         else 'PARAMETROS NO COINCIDEN' end as estado
  from e)
select fn, origen, keys as manda_el_js, estado,
  (select string_agg(coalesce(array_to_string(p.proargnames,','),''), '   ||   ')
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=dx.fn) as espera_supabase
from dx where estado <> 'ok' order by estado, fn;""")
