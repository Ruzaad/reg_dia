#!/bin/sh
# Empaqueta PGlite para el navegador en sim/pg/ (un solo archivo + wasm y extensiones).
set -e
A=""; for m in fs path url module crypto worker_threads child_process fs/promises; do A="$A --alias:$m=./build/vacio.js"; done
mkdir -p sim/pg
npx esbuild build/pglite-entrada.js --bundle --format=esm --platform=browser --minify --outfile=sim/pg/pglite.js $A
# las extensiones quedan junto al paquete
sed -i 's|"\.\./pgcrypto.tar.gz"|"./pgcrypto.tar.gz"|; s|"\.\./uuid-ossp.tar.gz"|"./uuid-ossp.tar.gz"|' sim/pg/pglite.js
D=node_modules/@electric-sql/pglite/dist
cp $D/pglite.wasm $D/pglite.data $D/initdb.wasm $D/pgcrypto.tar.gz $D/uuid-ossp.tar.gz sim/pg/
