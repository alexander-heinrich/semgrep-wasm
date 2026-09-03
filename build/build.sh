#!/bin/sh
# Usage: sh scripts/rebuild-engine/build.sh [--target ocaml|wasm|export] [extra docker build args]
# Produces scripts/rebuild-engine/out/{engine,csharp,python}/ (gitignored). Needs Docker (Colima works).
set -eu
cd "$(dirname "$0")"
target=export
if [ "${1:-}" = "--target" ]; then target=$2; shift 2; fi
if [ "$target" = export ]; then
  exec docker build --progress=plain --target export --output type=local,dest=out "$@" .
else
  exec docker build --progress=plain --target "$target" -t "semgrep-js-$target" "$@" .
fi
