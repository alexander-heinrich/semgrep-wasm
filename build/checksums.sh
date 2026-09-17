#!/bin/sh
# Regenerates dist/SHA256SUMS over the engine artifacts and the three loader files. install.sh calls this after
# copying a fresh build; run it on its own after editing a loader file. Usage: sh build/checksums.sh
set -eu
cd "$(dirname "$0")/../dist"
shasum -a 256 engine-[0-9]*.mjs engine-[0-9]*.cjs csharp-* python-* cpp-* engine-output.js engine-node.mjs semgrep-worker.js > SHA256SUMS
cat SHA256SUMS
