# Rebuilding the browser engine

`docs/vendor/semgrep/` holds a WebAssembly/JavaScript build of the Semgrep OSS engine and of its C# and
Python parsers. We build it ourselves from the Semgrep source tree at tag **v1.81.0** (2024-07-24). This
file records why, how, and every obstacle that had to be cleared, so the build can be repeated or moved
to another machine.

```sh
sh scripts/rebuild-engine/build.sh              # → scripts/rebuild-engine/out/{engine,csharp,python}/ (gitignored)
sh scripts/rebuild-engine/install.sh [1.81.0]   # → docs/vendor/semgrep/*.{mjs,cjs,wasm} + SHA256SUMS
node scripts/semantics_check.mjs                # 67 pattern-semantics checks
node scripts/wasm_parity.mjs                    # every challenge through the new build
node scripts/browser-test.mjs --all             # headless Chrome, end to end
```

Requirements: Docker (Colima works), about 15 GB of image space, and roughly 15 minutes.

## Why build it at all

The site used to load the WebAssembly packages Semgrep published to npm in April 2023
(`@semgrep/engine@1.17.1-alpha.2` plus `@semgrep/languages@1.17.1-alpha.0`). Those were the newest ones
that exist: `@semgrep/engine` stopped at 1.18.1 and `@semgrep/languages` at 1.17.1-alpha.2, both in April
2023. That engine had real gaps — no regex support of any kind, `metavariable-analysis` crashing on an
assert, `paths` ignored, no rendered fixes, no message interpolation — which forced four challenges to be
practiced only in the terminal and shaped the wording of several others.

The build tooling that produces those packages lived in the `js/` directory of the Semgrep repository. It
is present at tag `v1.81.0` and gone immediately after: on the day of that release a commit titled
"Move LSP.js" deleted all 291 files with the note *"moving lspjs + turbo mode to proprietary"*. So
`v1.81.0` is the newest browser engine obtainable outside Semgrep, and it is 15 months newer than the npm
packages. Opengrep, the LGPL fork, is no help here: it forked at Semgrep v1.100.0, five months after the
deletion, so its tree never contained `js/`, and its "playground" is an Electron app that spawns the
native binary.

## The pipeline

`Dockerfile` mirrors the upstream CI workflow `.github/workflows/build-test-javascript.yml` at that tag,
in three stages:

| stage | image | work | time |
|---|---|---|---|
| `ocaml` | `ocaml/opam:alpine-3.18-ocaml-4.14` | clone the tag with submodules, install the opam dependencies, build the tree-sitter runtime, `dune build js/engine js/languages/{csharp,python} --profile=release` | ~7 min |
| `wasm-libs` | `emscripten/emsdk:3.1.51` | compile PCRE 8.45, PCRE2 10.43 and libyaml to WebAssembly | ~5 min |
| `wasm` → `export` | same | compile the tree-sitter parsers to WebAssembly, bundle everything with esbuild, export the `dist/` directories | ~1 min |

Only the engine and the C# and Python parsers are built. Python is needed because
`metavariable-comparison` parses its comparison expression with a Python parser. Upstream builds all 33
languages, which takes far longer and produces files we would not ship.

Per-step timings from the reference build (Apple M3, Colima with 6 CPUs, 12 GiB, Rosetta for the amd64
emsdk image):

| step | time |
|---|---|
| clone with submodules | 157 s |
| opam repository snapshot | 3 s |
| opam update + tree-sitter runtime | 28 s |
| install 212 opam packages | 150 s |
| `dune build` (js_of_ocaml) | 61 s |
| prune and export the stage image | 96 s |
| PCRE, PCRE2, libyaml to WebAssembly | 297 s |
| engine bundle | 20 s |
| C# and Python parser bundles | 51 s |

## The obstacles, in the order they appeared

**1. The build image no longer exists.** Upstream CI used `returntocorp/ocaml:alpine-2024-01-18`, which
has been deleted from Docker Hub (its repository returns 404). Its recipe survives in the archived public
repository `semgrep/ocaml-layer`, whose `configs/alpine.sh` pins `from=alpine:3.18` and
`opam_switch=4.14.0`. The public `ocaml/opam:alpine-3.18-ocaml-4.14` image is the same combination and
works unchanged.

**2. A dev-only dependency blocked the solver.** `make install-opam-deps` installs three opam files,
one of which, `dev/required.opam`, pins `ocamlformat = 0.26.2` for the pre-commit hook. That version is no
longer in the package index, so the solver refused everything with "no matching version". It has nothing
to do with building, so the Dockerfile installs only `./` and the tree-sitter package.

**3. Today's package index does not match the release.** Even after dropping `ocamlformat`, the
dependency universe has moved on in two years. The fix is to pin the opam repository to snapshot
`4f54a686f4935d5a27d6746496f2c422170bfd9a`, the last commit on the release day. Two false starts here:

- `opam repository set-url` with a `https://github.com/…/archive/<sha>.tar.gz` URL fails, because opam's
  curl invocation does not follow GitHub's 302 to codeload, and reports a bare 404.
- The direct codeload URL fails too, for a different reason: opam treats an `http` repository URL as a
  directory and asks for `<url>/index.tar.gz`.

What works is to download and unpack the snapshot with `curl`, then point opam at the local directory.
The base image ships its own opam snapshot, but `opam update` re-syncs it from `file://`, so the pin has
to be explicit.

**4. Two packages fail checksum verification.** With the snapshot pinned, `ambient-context.0.1.0` and
`ambient-context-lwt.0.1.0` abort the install with "Bad checksum". Their upstream archives no longer hash
to what the 2024 index recorded. Rather than disabling verification, the Dockerfile sets
`archive-mirrors: "https://opam.ocaml.org/cache"` in the snapshot's `repo` file. The opam project's own
content-addressed source cache still serves the exact bytes the checksums expect, so verification passes
and every package is the version the release was built against. 212 packages then install in 150 seconds.

**5. esbuild cannot write its output.** The emscripten stage failed with `Failed to write to output file:
… dist/index.cjs: permission denied`, while running as root, in a directory root had just created — and
the same command succeeded when writing to `/tmp`. The cause is npm: since version 7, when run as root it
drops privileges to the owner of the working directory. The tree copied from the OCaml stage is owned by
uid 1000, so `npx` ran esbuild as that user, which could not write into the root-owned `dist/`. One
`chown -R root:root js` before the make fixes it. Splitting the stage in two (`wasm-libs`, then `wasm`)
kept the five-minute PCRE compilation cached while iterating on this.

**6. The engine caches parsed targets by path.** After the artifacts were in place, one challenge failed
with `Invalid_argument: String.sub / Bytes.sub` — but only when several rules ran in the same process, and
only for that one challenge. Each run was overwriting `rules.json` and the target at the same paths, and
the engine reuses a parsed target keyed by path, so it applied a stale AST to new file contents. Both the
worker and the Node loader now write each run into its own `run-<n>/` directory. A `paths:` glob such as
`tests/**` still applies, because Semgrep matches those at any depth; that is verified against the CLI.

**7. Fix rendering moved into the engine.** The 2023 build never emitted `extra.fix`, so the page rendered
autofixes itself by substituting metavariables. The new engine renders them properly, and the old
client-side renderer was overwriting good output with a worse guess. It is now a fallback that only fills
in matches the engine left unrendered.

**8. One end-to-end assertion was too strict.** With `paths` working, the challenge whose correct answer
is "no findings" now legitimately highlights nothing, and the browser test's "matched lines highlighted"
check failed on it. The check now passes when a challenge expects no matches at all.

## API differences from the 2023 build

| | 2023 npm build | v1.81.0 build |
|---|---|---|
| file creation | global `jsoo_create_file(path, text)` | `engine.writeFile(path, text)`, `engine.deleteFile(path)` |
| run | `execute(lang, rulesFile, targetFile)` | `execute(lang, rulesFile, root, [targetFiles])` |
| output | core JSON: `matches[]` with `rule_id`, `location` | CLI JSON: `results[]` with `check_id`, `start`/`end`, interpolated `extra.message`, rendered `extra.fix` |
| parser wasm | resolved relative to the worker URL, needed a `fetch` redirect | passed explicitly: `ParserFactory(wasmUrl)` |
| runtime primitives | missing; needed a hand-written `jsoo_runtime` shim for ctypes, uint64 and POSIX type tags | complete (`ctypes_stubs_js`, `integers_stubs_js` are linked) |
| rule format | YAML broken, rules had to be converted to JSON | either; we still pass JSON |
| severities | `ERROR`/`WARNING`/`INFO` only | all current names |

`docs/js/engine-output.js` converts the CLI JSON into the core-style shape the grader and the UI already
consumed, so the rest of the site did not have to change. The runtime shim, the severity rewriting and the
JSON-only rule path are gone.

## What the site loads

| file | bytes |
|---|---|
| `engine-1.81.0.mjs` | 6,351,287 |
| `csharp-1.81.0.mjs` | 3,351,311 |
| `csharp-1.81.0.wasm` | 5,693,063 |
| `python-1.81.0.mjs` | 3,823,434 |
| `python-1.81.0.wasm` | 425,874 |

That is 19.6 MB, against 17.2 MB for the 2023 files; the parsers now ship separate WebAssembly side-cars
and the engine links PCRE and PCRE2. Everything is gzipped by GitHub Pages and cached after the first
visit. Engine and both parsers are ready about 540 ms after the worker starts, and a rule run takes 5 to
70 ms. The matching `.cjs` builds are vendored alongside for the Node scripts; the browser never loads
them.

## Verification

Reference is Semgrep 1.172.0, invoked by `scripts/build.py` on every challenge.

| suite | result |
|---|---|
| `scripts/build.py --strict-coverage` | 33 challenges, 22/22 cheatsheet entries, 29/29 rule keys |
| `scripts/wasm_parity.mjs` | 33/33, no challenge left CLI-only |
| `scripts/semantics_check.mjs` | 67/67 |
| `scripts/browser-test.mjs --all` | 332 checks |
| 31 rule-key probes | identical to the CLI, including error cases |
| 29 C# 9–14 syntax probes | identical, including the same partial-parse errors |
| network check (DevTools protocol) | 19 requests during a full run, all to the local origin, none external |

Ten expectations in the semantics suite turned out to describe Semgrep behaviour that had never been
verified against the CLI. They were re-derived from the CLI and corrected; the engine had been right.

Quirks that remain are shared with the current CLI, not artefacts of the build: `catch (...) { ... }`
without `try` matches nothing while `try { ... }` alone fails to parse, `"..."` does not match
interpolated strings, unknown top-level rule keys are ignored (the page warns), `metavariable-type` only
resolves types declared in the file, and C# 12 primary constructors, `using X = (int, int)` aliases,
`ref readonly` parameters, C# 14 extension members and `a?.b = c` produce partial-parse errors.

## There is no next version

Nothing newer than `v1.81.0` can be built this way, so this is a one-time gain rather than a track to
follow. If a rule ever behaves differently here than in a current release, the CLI is the reference, and
`scripts/check.py` runs the same challenges against whatever Semgrep or Opengrep is installed.

## Licensing

The Semgrep engine and parsers are LGPL-2.1, and building them from a public tag and shipping the result
is squarely within that licence. See `THIRD_PARTY_NOTICES.md` for the obligations and how this repository
meets them.
