# Semgrep WASM build

This directory is `dist/` of https://github.com/alexander-heinrich/Semgrep-WASM. Built from https://github.com/semgrep/semgrep at tag v1.81.0 (2024-07-24) with `build/`
(OCaml 4.14.0 / js_of_ocaml 5.7.2 / emscripten 3.1.51; opam-repository snapshot 4f54a686 from the same day).

| file | upstream target | license |
|---|---|---|
| engine-1.81.0.mjs / .cjs | js/engine dist/index.mjs, dist/index.cjs (libpcre, libpcre2, libyaml inlined as wasm) | LGPL-2.1 |
| csharp-1.81.0.mjs / .cjs / .wasm | js/languages/csharp dist/index.mjs, dist/index.cjs, dist/semgrep-parser.wasm | LGPL-2.1 |
| python-1.81.0.mjs / .cjs / .wasm | js/languages/python (same layout) | LGPL-2.1 |

The `.mjs` files and the `.wasm` side-cars are what a browser loads (`semgrep-worker.js` is a worker that does
so); the `.cjs` files are for Node (`engine-node.mjs`); `engine-output.js` converts the engine's CLI-shaped JSON
for both. SHA256SUMS covers all of it. Build notes and the comparison with the current CLI: docs/RESULTS.md.
