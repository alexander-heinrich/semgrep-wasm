# Vendored Semgrep WASM builds

| file | npm package | published | license |
|---|---|---|---|
| engine-1.17.1-alpha.2.mjs | @semgrep/engine@1.17.1-alpha.2 (dist/index.mjs) | 2023-04-10 | LGPL-2.1 |
| csharp-1.17.1-alpha.0.mjs | @semgrep/languages@1.17.1-alpha.0 (dist/csharp/index.mjs) | 2023-04-10 | LGPL-2.1 |
| python-0.0.4.mjs + semgrep-parser.wasm | @semgrep/lang-python@0.0.4 (dist/index.mjs, dist/semgrep-parser.wasm) | 2023-04-23 | LGPL-2.1 |

Files are unmodified copies from the npm registry (via cdn.jsdelivr.net); checksums in SHA256SUMS.
Source: https://github.com/semgrep/semgrep (the `js/` directory at tag v1.17.1 / v1.18.0; removed from `develop` after v1.81.0).
See spike/RESULTS.md for why these exact versions and what glue is required.
