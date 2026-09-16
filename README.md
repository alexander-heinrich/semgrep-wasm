# Semgrep-WASM

The Semgrep OSS engine compiled for the browser, rebuilt from the last open-source tag that still
contains the browser build tooling: **v1.81.0** (July 2024). The engine plus the C# and Python parsers
ship in `dist/` as JavaScript (via js_of_ocaml) and WebAssembly (via emscripten), together with a Node loader
and an example worker, so that directory is the whole thing to copy; alongside it, the reproducible Docker build, and the test suites that show the build agreeing with
the current Semgrep release.

Not affiliated with, sponsored by, or endorsed by Semgrep, Inc. "Semgrep" is a trademark of Semgrep,
Inc. and is used here only to refer to their software. The engine and parsers are LGPL-2.1 and
unmodified; everything else here is MIT. See `THIRD_PARTY_NOTICES.md`.

Live demo: the [Semgrep Dojo](https://github.com/alexander-heinrich/Semgrep-Dojo) grades C# rule-writing
exercises with this build, entirely in the page.

## Why this exists

Semgrep published WebAssembly packages to npm in April 2023 (`@semgrep/engine`, `@semgrep/languages`)
and never again. The tooling that produces them lived in the `js/` directory of the Semgrep repository
until the day v1.81.0 was released, when a commit titled "Move LSP.js" deleted all 291 files with the
note *moving lspjs + turbo mode to proprietary*. So v1.81.0 is the newest browser engine obtainable
outside Semgrep, 15 months newer than the npm packages, and it closes every gap those packages had:
the regex operators, `metavariable-analysis`, `metavariable-type`, `paths`, version constraints,
focus lists, `by-side-effect: only`, non-exact taint sinks, constant fields, rendered messages and
fixes, and the current severity names.

Nothing newer can be built this way. This is a one-time reconstruction, not a track to follow.

## Using it

**In a browser.** Load the engine and a parser in a module Web Worker; `dist/semgrep-worker.js` is a
complete example. It answers `{type:'run', id, rules, lang, targets: [{path, text}]}` messages with
`{type:'result', id, matches, errors, ms}` — one engine call for all the targets, `lang` defaulting to
`csharp`, reported paths as given (the single-file form `target` + `targetPath` still works). Underneath,
the parser's WebAssembly side-car is passed explicitly:

```js
const { EngineFactory } = await import('./dist/engine-1.81.0.mjs');
const engine = await EngineFactory();
const { ParserFactory } = await import('./dist/csharp-1.81.0.mjs');
engine.addParser(await ParserFactory(new URL('./dist/csharp-1.81.0.wasm', import.meta.url).href));

engine.writeFile('run-1/rules.json', JSON.stringify({ rules: [rule] }));
engine.writeFile('run-1/Program.cs', source);
const out = JSON.parse(engine.execute('csharp', 'run-1/rules.json', '.', ['run-1/Program.cs']));
// out.results[] in Semgrep's CLI JSON shape; dist/engine-output.js converts it to a simpler form
```

Two things to know. The engine caches parsed targets by path, so give every run its own directory.
And relative paths resolve against the pseudo-filesystem's working directory, so a `paths:` glob sees the
same target path the CLI would. The Python parser, added the same way with `python-1.81.0.mjs` and its
`.wasm`, serves two purposes: `metavariable-comparison` expressions are parsed as Python, and with
`execute('python', …)` the engine runs rules on Python targets. `generic` and `regex` need no parser at all.
Rules whose `languages` do not include the language passed to `execute` are skipped silently.

**In Node.** `dist/engine-node.mjs` loads the CommonJS builds and exposes `execute(rules, target, path,
lang = 'csharp')` and `executeMany(rules, [{path, text}], lang)`.

```sh
npm install
node scripts/run_rule.mjs --rule rule.yaml --target Program.cs                 # findings as JSON
node scripts/run_rule.mjs --rule rule.yaml --target app.py --lang python
```

Sizes: engine 6.4 MB, C# parser 3.4 MB plus 5.7 MB of WebAssembly, Python parser 3.8 MB plus 0.4 MB.
Engine and both parsers are ready about 540 ms after a worker starts; a rule run takes 5 to 70 ms.

## Verifying it

Reference is Semgrep 1.172.0; Opengrep 1.29.0 gives identical answers. Every suite runs on C#, the
only language verified in depth: the rule-syntax evidence exercises language-independent engine code and
largely transfers, the syntax evidence covers the C# grammar and its translation only and transfers to no
other language. Python has a smoke test only (three cases in the semantics suite, checked against the
same CLI), and four further cases cover multi-target runs.

```sh
node scripts/semantics_check.mjs        # 74 pattern-semantics checks against stored CLI-derived answers
python3 scripts/engine_probes.py        # 60 differential probes: this build vs semgrep vs opengrep on PATH
```

| suite | result |
|---|---|
| `scripts/semantics_check.mjs`, 67 C# cases + 3 Python + 4 multi-target | 74/74 |
| `scripts/engine_probes.py rules`, 31 rule-key probes | identical to the CLI, including error cases |
| `scripts/engine_probes.py syntax`, 29 C# 9–14 samples | identical, including the same partial-parse errors |

Recorded probe output is committed as `tests/probe-results.jsonl`. Ten of the semantics expectations
were originally wrong and were re-derived from the CLI; the engine had been right. Quirks that remain
are shared with the current CLI: `catch (...) { ... }` without `try` matches nothing while `try { ... }`
alone fails to parse, `"..."` does not match interpolated strings, unknown top-level rule keys are
ignored, and `metavariable-type` only resolves types declared in the file.

## Rebuilding it

```sh
sh build/build.sh        # Docker: OCaml stage, then emscripten stage → build/out/{engine,csharp,python}/
sh build/install.sh      # → dist/ under versioned names, SHA256SUMS refreshed
```

Needs Docker (Colima works), about 15 GB of image space, and roughly 15 minutes on an Apple-silicon
Mac. Only the engine and the C# and Python parsers are built; upstream builds all 33 languages, and
adding one here means naming it in the Dockerfile.

`build/Dockerfile` mirrors the upstream CI workflow `.github/workflows/build-test-javascript.yml` at the
tag, in three stages:

| stage | image | work | time |
|---|---|---|---|
| `ocaml` | `ocaml/opam:alpine-3.18-ocaml-4.14` | clone the tag with submodules, install 212 opam packages, build the tree-sitter runtime, `dune build js/engine js/languages/{csharp,python} --profile=release` | ~7 min |
| `wasm-libs` | `emscripten/emsdk:3.1.51` | compile PCRE 8.45, PCRE2 10.43 and libyaml to WebAssembly | ~5 min |
| `wasm` → `export` | same | compile the tree-sitter parsers to WebAssembly, bundle everything with esbuild, export the `dist/` directories | ~1 min |

### The obstacles, in the order they appeared

Each one blocked the next, which is why building a two-year-old tree today takes a recipe rather than a
command.

1. **The build image had been deleted.** Upstream CI used `returntocorp/ocaml:alpine-2024-01-18`, gone
   from Docker Hub. Its recipe survives in the archived `semgrep/ocaml-layer` repository (Alpine 3.18,
   OCaml 4.14.0); the public `ocaml/opam:alpine-3.18-ocaml-4.14` image is the same combination.
2. **A dev-only dependency blocked the solver.** `dev/required.opam` pins `ocamlformat = 0.26.2` for the
   pre-commit hook; that version has left the index. It is not needed to build and is skipped.
3. **Today's package index does not match the release.** The opam repository is pinned to snapshot
   `4f54a686`, the last commit on the release day. A GitHub archive URL fails because opam's downloader
   does not follow the redirect to codeload; the codeload URL fails because opam treats a web repository
   as a directory and asks for an index file. Download and unpack the snapshot with `curl`, then point
   opam at the local directory.
4. **Two packages fail checksum verification.** `ambient-context` and `ambient-context-lwt` 0.1.0 no
   longer hash to what the 2024 index recorded. The snapshot's `archive-mirrors` is pointed at
   opam.ocaml.org's content-addressed source cache, which still serves the original bytes.
5. **esbuild could not write its output**, as root, into a directory root had just created. npm ≥ 7 drops
   privileges to the owner of the working directory; the tree copied from the OCaml stage is owned by uid
   1000. One `chown -R root:root js` fixes it.
6. **The engine caches parsed targets by path**, so reusing file names across runs applies a stale
   syntax tree and eventually throws `Invalid_argument: String.sub`. Every run gets its own directory.
7. **Fix rendering moved into the engine.** The 2023 build never emitted `extra.fix`; this one does.
8. **Interface changes.** `execute(lang, rulesFile, root, [targets])` plus `writeFile`/`deleteFile`
   replace the create-once `jsoo_create_file` global; output is the CLI JSON shape (`results[]` with
   `check_id`, interpolated `extra.message`, rendered `extra.fix`); parser WebAssembly is passed
   explicitly; the ctypes and integers JavaScript stubs are linked, so no runtime shim is needed.

The full investigation, including the retired 2023 engine's gap table, is in `docs/RESULTS.md`.

## Layout

| path | what |
|---|---|
| `dist/` | the eight built files, the LGPL licence text, `SHA256SUMS`, `VERSIONS.md`, and the three loader files: `engine-output.js` (CLI JSON → simple shape), `engine-node.mjs` (Node loader), `semgrep-worker.js` (browser worker). Copy this directory as a whole. |
| `build/` | `Dockerfile`, `build.sh`, `install.sh`, `checksums.sh` (refreshes `dist/SHA256SUMS` after a loader edit) |
| `scripts/` | `run_rule.mjs`, `semantics_check.mjs`, `engine_probes.py` |
| `tests/` | the 74 semantics cases and their C# and Python targets, the recorded probe results |
| `docs/` | `RESULTS.md`, the feasibility investigation and the gap table of the 2023 packages |
| `spike/` | the 2023 harness (Node and browser smoke tests, runtime shims) that `docs/RESULTS.md` describes |
