#!/bin/sh
# Usage: sh build/build.sh [--target ocaml|wasm|export] [extra docker build args]
# Produces build/out/{engine,csharp,python,cpp}/ (gitignored). Needs Docker (Colima works).
set -eu
cd "$(dirname "$0")"
target=export
if [ "${1:-}" = "--target" ]; then target=$2; shift 2; fi
if [ "$target" = export ]; then
  exec docker build --progress=plain --target export --output type=local,dest=out "$@" .
else
  exec docker build --progress=plain --target "$target" -t "semgrep-js-$target" "$@" .
fi
