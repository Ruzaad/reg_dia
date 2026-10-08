#!/bin/sh
# Arma la carpeta sim/ desde un checkout de la app (por defecto, el repo local).
# Uso: build/armar_sim.sh [ruta_repo]
set -e
REPO=${1:-..}
mkdir -p sim/app sim/datos
for f in index.html operario.html supervisora.html ingenieria.html app.js ingenieria.js costos.js dinamico.js style.css rediseno.css icon-192.png icon-512.png manifest.json; do
  cp "$REPO/$f" sim/app/
done
# el shim va antes que cualquier otro script de la página
for h in sim/app/*.html; do
  sed -i 's|<head>|<head>\n<script src="shim.js"></script>|' "$h"
done
cp build/datos.tgz sim/datos/datos.tgz
cp build/tickets_cache.csv.gz sim/datos/tickets.csv.gz
# librerías locales: el artefacto no deja cargar hojas de estilo de cdnjs.
# xlsx sigue desde cdnjs (trae bytes de control que el artefacto no acepta)
L=node_modules; mkdir -p sim/app/lib
cp $L/flatpickr/dist/flatpickr.min.css $L/flatpickr/dist/flatpickr.min.js sim/app/lib/
cp $L/chart.js/dist/chart.umd.js sim/app/lib/chart.umd.min.js
sed -i 's|https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/|lib/|g; s|https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/|lib/|' sim/app/ingenieria.html
# Los artefactos solo sirven tipos web: los binarios van en base64 como .txt
b64(){ base64 -w0 "$1" > "$2"; rm -f "$1"; }
b64 sim/datos/datos.tgz sim/datos/datos.b64.txt
b64 sim/datos/tickets.csv.gz sim/datos/tickets.b64.txt
for f in pglite.data pgcrypto.tar.gz uuid-ossp.tar.gz; do [ -f sim/pg/$f ] && base64 -w0 sim/pg/$f > sim/pg/$f.b64.txt; done
