# Rebuilding the browser engine

`docs/vendor/semgrep/` holds a WebAssembly/JavaScript build of the Semgrep OSS engine and of its C# and
Python parsers. It is built from the Semgrep source tree at tag **v1.81.0** (2024-07-24) — the last tag
that still contains the upstream `js/` build tooling, which Semgrep moved into its proprietary repository
the same day. The npm packages Semgrep once published (`@semgrep/engine`, `@semgrep/languages`) stopped in
April 2023, so this is the newest browser engine obtainable outside Semgrep.

```sh
sh scripts/rebuild-engine/build.sh              # → scripts/rebuild-engine/out/{engine,csharp,python}/ (gitignored)
sh scripts/rebuild-engine/install.sh [1.81.0]   # → docs/vendor/semgrep/*.{mjs,cjs,wasm} + SHA256SUMS
node scripts/semantics_check.mjs                # 67 pattern-semantics checks
node scripts/wasm_parity.mjs                    # all challenges through the new build
node scripts/browser-test.mjs --all             # headless Chrome end to end
```

Needs Docker (Colima works) and roughly 15 GB of image space. Two stages mirror the upstream
`build-test-javascript` workflow: `ocaml/opam:alpine-3.18-ocaml-4.14` compiles the OCaml to JavaScript with
js_of_ocaml, then `emscripten/emsdk:3.1.51` compiles PCRE, PCRE2, libyaml and the tree-sitter parsers to
WebAssembly and bundles everything with esbuild. On an M3 with Colima (6 CPUs, 12 GiB, Rosetta for the
amd64 emsdk image) the whole build takes about 15 minutes.

Intentional deviations from upstream CI, each needed to make a two-year-old build work today:

- `returntocorp/ocaml:alpine-2024-01-18` was deleted from Docker Hub, so the base image is the equivalent
  public `ocaml/opam` image (Alpine 3.18, OCaml 4.14.0, the version its recipe in the archived
  `semgrep/ocaml-layer` repository used).
- The opam repository is pinned to snapshot `4f54a686` from the release day, with `archive-mirrors` set to
  opam.ocaml.org's source cache; two 2024 packages otherwise fail checksum verification against today's
  GitHub archives.
- `dev/required.opam` (an `ocamlformat` pin for the pre-commit hook) and the static libcurl step (native
  binaries only) are skipped.
- The copied source tree is `chown`ed to root: npm ≥ 7 drops privileges to the owner of the working
  directory, so `npx esbuild` could not write into root-owned `dist/` directories.
- Only `js/engine`, `js/languages/csharp` and `js/languages/python` are built (Python is what
  `metavariable-comparison` parses its expression with).

Everything is LGPL-2.1 and unmodified Semgrep source; see `THIRD_PARTY_NOTICES.md`. Verification results and
the differences from the retired 2023 engine are in `spike/RESULTS.md`.
