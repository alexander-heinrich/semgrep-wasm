# Spike results — in-browser Semgrep for C# (2026-09-02)

## Verdict: viable

Chosen pair (vendored in `docs/vendor/semgrep/`, checksums in `SHA256SUMS`):

| component | package | notes |
|---|---|---|
| engine | `@semgrep/engine@1.17.1-alpha.2` (`dist/index.mjs`, 4.7 MB) | alpha.3 behaves identically; 1.18.x is AST-incompatible with every published parser (all matches fail with `Cannot read properties of undefined`) |
| C# parser | `@semgrep/languages@1.17.1-alpha.0` `./csharp` (8.9 MB) | alpha.1/alpha.2 parser builds lack the ctypes runtime entirely and cannot initialise |
| Python parser | `@semgrep/lang-python@0.0.4` (3.2 MB + `semgrep-parser.wasm` 432 KB) | only needed for `metavariable-comparison` (the comparison expression is parsed as Python); newer API generation, adapted with a 4-method shim |

Headless Chrome 150: engine + both parsers ready in ~300 ms (warm cache), a rule run takes 5–35 ms.

## Required glue (all in `docs/js/semgrep-worker.js`)

1. **Runtime shim** (`spike/jsoo-shims.mjs`): both bundles assign their primitive table to
   `globalThis.jsoo_runtime`; the parser's table lacks the ctypes/integers primitives its own
   `Unsigned`, `LDouble` and `PosixTypes` OCaml modules call at init. An accessor property on
   `jsoo_runtime` augments every assigned table with working uint32/uint64 arithmetic, size
   constants, long-double constants and ctypes enum tags. Never-called ctypes functions throw.
2. **JSON rules**: YAML rule parsing through the bundled libyaml is broken in every engine build
   (`Unsupported Yaml version 0.0` / TypeError). Convert YAML → JSON client-side and write
   `{rules:[...]}` as `rules.json`.
3. **Files**: `globalThis.jsoo_create_file(path, text)`; paths must be under `/static/` in the
   browser, and a path can only be created once → `/static/run/<n>/rules.json`, `/static/run/<n>/<target_path>`.
   In Node the runtime mounts the real filesystem at `/`, so the parity script writes real temp files.
4. **Silence `console.log`** during `execute()`: the alpha engine logs every ctypes read/write.
5. **Python parser adapter**: `{setMountPoints: m => raw.setMountpoints(m), getLang: () => raw.getLangs()[0],
   parsePattern: (pe, s) => raw.parsePattern(pe, lang, s), parseTarget: f => raw.parseTarget(lang, f)}`;
   its wasm side-car is resolved relative to the worker URL → wrap `fetch` to redirect
   `semgrep-parser.wasm` to the vendored file.
6. `execute()` throws OCaml exceptions as JS values (arrays) for rule errors (bad severity,
   unknown operator key) → catch and render `String(e)`; `errors[]` in the result carries pattern
   parse errors ("Invalid pattern for C#") and fatal engine asserts.
7. Node cannot import the `.mjs` builds (they detect Node and `require('fs')`); the parity script
   uses the `.cjs` builds downloaded into a gitignored cache.

## Feature table on the 2023 engine (Node harness `spike/run-each.py`, 67 checks)

Works as in current Semgrep: plain patterns, `pattern-either`, `pattern-not`, `pattern-inside`,
`pattern-not-inside`, statement ellipsis (dives into nested blocks and back, never above the block where the sequence starts), `$X`, `$_`, `$...ARGS`,
metavariable equality, typed metavariables `(string $S)`, deep expression `<... e ...>`, literal
string folding (`"hello" + " world"` matches `"hello world"`), `if ($C)` pitfall (0 matches),
`if ($C) { ... }`, `var $X = e;` vs `$X = e;`, method modifiers, `class $C { ... }`, `using X;`,
`focus-metavariable`, `metavariable-pattern` (incl. `language: generic`), `metavariable-comparison`
(with the Python parser), taint sources/sinks/sanitizers/propagators, `by-side-effect`,
`options.taint_unify_mvars`, `options.constant_propagation`, `fix`/`fix-regex` (matching only),
`min-version` accepted, `try { ... } catch ($T $E) { ... throw $E; }`.

Differs / broken → `wasm: cli-only` (or avoid in targets):

| feature | behaviour | consequence |
|---|---|---|
| `"..."` vs interpolated `$"..."` | plain `"..."` does not match interpolated strings | avoid interpolated strings on expected lines |
| `metavariable-regex` | filter is a no-op (every binding passes) | cli-only |
| `pattern-regex`, `pattern-not-regex` | engine exhausts memory (no PCRE linked) | cli-only |
| `metavariable-analysis` | `Assert_failure String_literal.ml` | cli-only |
| `paths` | ignored | cli-only |
| `metavariable-type` | rule error "unexpected key" | not supported (also experimental in current Semgrep) |
| severities `CRITICAL/HIGH/MEDIUM/LOW` | rule error | rewrite to `ERROR/WARNING/INFO` client-side |
| rendered `fix` | absent from output (`extra.fix` missing) | render client-side from `fix:` + `metavars` |
| `catch ($T $E) { ... }` without `try` | 0 matches | use the `try { ... } catch ... ` form |
| `try { ... }` without catch | pattern parse error | use `try { ... } catch ($T $E) { ... }` |
| unknown top-level rule keys | silently ignored | pre-validate client-side |
| `if (<call>) { ... }` (lone ellipsis body after a non-metavariable condition) | never matches (`if ($C) { ... }`, `{ $S; ... }`, `{ $S; }` and `if/else` forms work) | write if-bodies as `{ $S; ... }`; the page warns when it sees the `{ ... }` form |
| constant propagation of `const` fields | not followed (locals assigned a literal and literal concatenation are) | challenges use local-literal propagation |
| focused l-value source without `by-side-effect` | not tainted in either engine; `by-side-effect: true` works in both | fine |
| `metavariable-pattern` on a propagated identifier | sees the identifier text, not the literal (same in current CLI) | capture the literal at its declaration with `pattern-inside` |
| invalid pattern text (`Foo(`) | may silently match nothing | UI hint when 0 matches and pattern looks unbalanced |

Files: `spike/node-smoke.mjs` (harness), `spike/run-each.py` (one process per check),
`spike/semantics.json` (checks), `spike/browser-smoke.html` + `smoke-worker.js` (browser),
`spike/cdp-run.mjs` (headless Chrome driver over DevTools protocol).
