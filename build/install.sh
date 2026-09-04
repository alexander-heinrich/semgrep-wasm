#!/bin/sh
# Copies the artifacts produced by build.sh (out/) into dist/ under versioned names, removes the previous
# engine files and regenerates SHA256SUMS (which also covers the three loader files that ship in dist/). Usage: sh build/install.sh [TAG]
set -eu
cd "$(dirname "$0")"
TAG="${1:-1.81.0}"
DEST=../dist
test -f out/engine/index.mjs || { echo "out/engine/index.mjs missing — run build.sh first" >&2; exit 1; }
mkdir -p "$DEST"
rm -f "$DEST"/engine-[0-9]*.mjs "$DEST"/engine-[0-9]*.cjs "$DEST"/csharp-*.mjs "$DEST"/csharp-*.cjs "$DEST"/csharp-*.wasm \
      "$DEST"/python-*.mjs "$DEST"/python-*.cjs "$DEST"/python-*.wasm "$DEST"/semgrep-parser.wasm
cp out/engine/index.mjs "$DEST/engine-$TAG.mjs"
cp out/engine/index.cjs "$DEST/engine-$TAG.cjs"
for lang in csharp python; do
  cp "out/$lang/index.mjs" "$DEST/$lang-$TAG.mjs"
  cp "out/$lang/index.cjs" "$DEST/$lang-$TAG.cjs"
  cp "out/$lang/semgrep-parser.wasm" "$DEST/$lang-$TAG.wasm"
done
(cd "$DEST" && shasum -a 256 engine-[0-9]*.mjs engine-[0-9]*.cjs csharp-* python-* engine-output.js engine-node.mjs semgrep-worker.js > SHA256SUMS && cat SHA256SUMS && ls -la engine-* csharp-* python-*)
