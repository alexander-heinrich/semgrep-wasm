#!/bin/sh
# Copies the artifacts produced by build.sh (out/) into dist/ under versioned names, removes the previous
# engine files, flattens deep array literals (flatten_literals.mjs, needs `npm install`) and regenerates SHA256SUMS via checksums.sh (which also covers the three loader files that ship in dist/). Usage: sh build/install.sh [TAG]
set -eu
cd "$(dirname "$0")"
TAG="${1:-1.81.0}"
DEST=../dist
test -f out/engine/index.mjs || { echo "out/engine/index.mjs missing — run build.sh first" >&2; exit 1; }
mkdir -p "$DEST"
rm -f "$DEST"/engine-[0-9]*.mjs "$DEST"/engine-[0-9]*.cjs "$DEST"/semgrep-parser.wasm
for lang in csharp python cpp; do rm -f "$DEST/$lang"-*.mjs "$DEST/$lang"-*.cjs "$DEST/$lang"-*.wasm; done
cp out/engine/index.mjs "$DEST/engine-$TAG.mjs"
cp out/engine/index.cjs "$DEST/engine-$TAG.cjs"
for lang in csharp python cpp; do
  cp "out/$lang/index.mjs" "$DEST/$lang-$TAG.mjs"
  cp "out/$lang/index.cjs" "$DEST/$lang-$TAG.cjs"
  cp "out/$lang/semgrep-parser.wasm" "$DEST/$lang-$TAG.wasm"
done
# cap the nesting of array literals so the bundles also evaluate inside a WebKit worker (see flatten_literals.mjs)
node ./flatten_literals.mjs "$DEST"/engine-[0-9]*.mjs "$DEST"/engine-[0-9]*.cjs "$DEST"/csharp-*.mjs "$DEST"/csharp-*.cjs \
  "$DEST"/python-*.mjs "$DEST"/python-*.cjs "$DEST"/cpp-*.mjs "$DEST"/cpp-*.cjs
sh ./checksums.sh
(cd "$DEST" && ls -la engine-* csharp-* python-* cpp-*)
