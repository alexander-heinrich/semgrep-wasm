# Third-party notices

The build recipe, loaders and test suites in this repository are MIT-licensed (see `LICENSE`). The
engine and parsers they produce and ship are not ours.

## Semgrep engine and parsers (LGPL-2.1)

`dist/` contains a WebAssembly/JavaScript build of the Semgrep OSS engine and of its C# and Python
parsers, produced from the unmodified Semgrep source tree at tag `v1.81.0`
(https://github.com/semgrep/semgrep/tree/v1.81.0, released 2024-07-24) with the upstream `js/` build
tooling (js_of_ocaml 5.7.2, emscripten 3.1.51):

| file | upstream build target |
|---|---|
| `engine-1.81.0.mjs`, `engine-1.81.0.cjs` | `js/engine` (`dist/index.mjs`, `dist/index.cjs`) |
| `csharp-1.81.0.mjs`, `csharp-1.81.0.cjs`, `csharp-1.81.0.wasm` | `js/languages/csharp` (`dist/index.*`, `dist/semgrep-parser.wasm`) |
| `python-1.81.0.mjs`, `python-1.81.0.cjs`, `python-1.81.0.wasm` | `js/languages/python` |

Copyright (c) Semgrep, Inc. — licensed under the GNU Lesser General Public License v2.1. The complete
licence text is in `dist/LICENSE`, as published with the source at that tag.

How this distribution meets the licence: no Semgrep source was modified; the files are separately
loadable modules; the corresponding source is the tag named above together with the complete build
recipe in `build/` (Dockerfile, `build.sh`, `install.sh`), which lets anyone rebuild or replace the
library with a modified version; and `dist/SHA256SUMS` identifies exactly what is shipped.
`dist/VERSIONS.md` and `README.md` record the provenance and the build environment.

Embedded in those bundles: tree-sitter and tree-sitter-c-sharp (MIT), tree-sitter-python (MIT),
libyaml (MIT), PCRE 8.45 and PCRE2 10.43 (BSD-3-Clause), js_of_ocaml runtime (LGPL-2.1 with linking
exception), OCaml runtime (LGPL-2.1 with linking exception).

This project is not affiliated with, sponsored by, or endorsed by Semgrep, Inc. "Semgrep" is a trademark
of Semgrep, Inc. and is used here only to refer to their software.
