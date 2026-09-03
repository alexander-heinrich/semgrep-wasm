#!/bin/sh
# Copies the artifacts produced by build.sh (out/) into docs/vendor/semgrep/ under versioned names,
# removes the previous engine files and regenerates SHA256SUMS. Usage: sh scripts/rebuild-engine/install.sh [TAG]
set -eu
cd "$(dirname "$0")"
TAG="${1:-1.81.0}"
DEST=../../docs/vendor/semgrep
test -f out/engine/index.mjs || { echo "out/engine/index.mjs missing — run build.sh first" >&2; exit 1; }
mkdir -p "$DEST"
rm -f "$DEST"/engine-*.mjs "$DEST"/engine-*.cjs "$DEST"/csharp-*.mjs "$DEST"/csharp-*.cjs "$DEST"/csharp-*.wasm \
      "$DEST"/python-*.mjs "$DEST"/python-*.cjs "$DEST"/python-*.wasm "$DEST"/semgrep-parser.wasm
cp out/engine/index.mjs "$DEST/engine-$TAG.mjs"
cp out/engine/index.cjs "$DEST/engine-$TAG.cjs"
for lang in csharp python; do
  cp "out/$lang/index.mjs" "$DEST/$lang-$TAG.mjs"
  cp "out/$lang/index.cjs" "$DEST/$lang-$TAG.cjs"
  cp "out/$lang/semgrep-parser.wasm" "$DEST/$lang-$TAG.wasm"
done
(cd "$DEST" && shasum -a 256 engine-*.mjs engine-*.cjs csharp-* python-* > SHA256SUMS && cat SHA256SUMS && ls -la engine-* csharp-* python-*)
