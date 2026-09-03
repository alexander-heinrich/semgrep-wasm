# Vendored Semgrep WASM build

Built from https://github.com/semgrep/semgrep at tag v1.81.0 (2024-07-24) with `scripts/rebuild-engine/`
(OCaml 4.14.0 / js_of_ocaml 5.7.2 / emscripten 3.1.51; opam-repository snapshot 4f54a686 from the same day).

| file | upstream target | license |
|---|---|---|
| engine-1.81.0.mjs / .cjs | js/engine dist/index.mjs, dist/index.cjs (libpcre, libpcre2, libyaml inlined as wasm) | LGPL-2.1 |
| csharp-1.81.0.mjs / .cjs / .wasm | js/languages/csharp dist/index.mjs, dist/index.cjs, dist/semgrep-parser.wasm | LGPL-2.1 |
| python-1.81.0.mjs / .cjs / .wasm | js/languages/python (same layout) | LGPL-2.1 |

The `.mjs` files and the `.wasm` side-cars are what the site loads; the `.cjs` files are used by the Node
scripts (`scripts/wasm_parity.mjs`, `scripts/semantics_check.mjs`). Checksums in SHA256SUMS. Build notes and
the comparison with the current CLI: spike/RESULTS.md.
