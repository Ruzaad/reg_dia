# Simulador QA

La app de verdad (index, operario, supervisora, ingeniería) corriendo contra una
copia de la base que vive dentro del navegador (PGlite). Usa las mismas 216
funciones de producción, así que lo que se ve en el simulador es lo que la app
haría de verdad, pero nada llega a Supabase.

## Flujo QA → main

1. Cada mejora se arma en una rama y se prueba primero en el simulador.
2. Ruzaad la prueba en el artefacto "Samitex QA".
3. Cuando dice "despliega en main": se fusiona a `main` (Vercel publica solo) y,
   si trae `sql/parche_N.sql`, él lo corre en el SQL Editor como siempre.
4. Si la mejora trae parche, se aplica también sobre la copia (`raw/`) antes de
   rearmar la base del simulador, para que el QA ya lo tenga.

## Qué hay aquí

- `sql/`: consultas de solo lectura que sacan el esquema, las funciones y los
  datos. Personal con DNI y nombre cambiados, PIN 1234, sin tokens. Los usuarios
  de oficina mantienen su usuario.
- `build/ddl.py`: arma el DDL en orden (tablas, funciones, constraints, índices,
  vistas, triggers).
- `build/build.mjs`: crea la base en PGlite, carga los datos, rehace
  `tickets_cache` con `fn_tickets_cache_refrescar` y deja la base lista.
- `build/podar.py`: quita los segmentos de WAL que no hacen falta y comprime.
- `build/pglite.sh`: empaqueta PGlite para el navegador.
- `build/armar_sim.sh`: copia las pantallas de la app y les pone `shim.js`
  delante.
- `sim/index.html`: la mesa de pruebas (celular y PC lado a lado, perfiles,
  registro de cada llamada y botón para volver a la copia).
- `sim/app/shim.js`: desvía `fetch` a Supabase hacia la base del navegador y le
  da a cada equipo su propio `localStorage`.

## Rearmar

```sh
cd qa
npm install
# guardar en raw/ el resultado de sql/1..5 (funciones.txt, esquema.txt,
# chicas.txt, reclamos.json, bases.json)
npm run todo
```

`raw/`, `sim/datos/` y todo lo generado están en `.gitignore`: las copias de
producción nunca van a GitHub.

## Qué no corre en el simulador

- La revisión con IA (Gemini) responde que no está disponible.
- La escritura al Google Sheet ALMACÉN se da por hecha sin escribir nada.
- La hora es la del reloj del navegador.
