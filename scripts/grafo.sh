#!/usr/bin/env bash
# Arma o actualiza el grafo del código (graphify). Uso: bash scripts/grafo.sh
# Solo AST local: sin LLM, sin claves, nada sale de la máquina. ~5 s.
# El grafo queda en graphify-out/ (ignorado en git y en Vercel: no se publica).
set -u
cd "$(dirname "$0")/.." || exit 0

if ! command -v graphify >/dev/null 2>&1; then
  python3 -m pip install -q "graphifyy[sql]" >/dev/null 2>&1 || exit 0
fi

if [ -f graphify-out/graph.json ]; then
  graphify update . >/dev/null 2>&1
else
  graphify extract . --code-only >/dev/null 2>&1 \
    && graphify cluster-only . --no-viz --no-label >/dev/null 2>&1
fi
exit 0
