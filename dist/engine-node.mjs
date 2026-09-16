// Node loader for the browser engine (CommonJS builds rebuilt from semgrep tag v1.81.0).
// Lives inside dist/ next to the engine files (copy the directory as a whole to embed elsewhere); used by
// scripts/run_rule.mjs and scripts/semantics_check.mjs.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEngineOutput, describeThrown, sanitizeTargetPath, stripRunDir } from './engine-output.js';

export const VENDOR = path.dirname(fileURLToPath(import.meta.url));
export const FILES = {
  engine: 'engine-1.81.0.cjs',
  csharp: 'csharp-1.81.0.cjs', csharpWasm: 'csharp-1.81.0.wasm',
  python: 'python-1.81.0.cjs', pythonWasm: 'python-1.81.0.wasm',
};

/**
 * Loads engine + C# + Python parsers. js_of_ocaml captures the working directory when a bundle loads and
 * resolves relative paths there — exactly like the browser's pseudo-filesystem — so the loader chdirs into
 * a scratch directory first; `paths:` globs then see the same target path as the CLI.
 */
export async function loadEngine({ verbose = false } = {}) {
  const fsRoot = mkdtempSync(path.join(os.tmpdir(), 'dojo-engine-'));
  const startDir = process.cwd();
  process.chdir(fsRoot);
  const require = createRequire(import.meta.url);
  const { EngineFactory } = require(path.join(VENDOR, FILES.engine));
  const engine = await EngineFactory();
  const cs = require(path.join(VENDOR, FILES.csharp));
  engine.addParser(await cs.ParserFactory(path.join(VENDOR, FILES.csharpWasm)));
  const py = require(path.join(VENDOR, FILES.python));
  engine.addParser(await py.ParserFactory(path.join(VENDOR, FILES.pythonWasm)));
  if (verbose) console.error(`engine loaded; parsers: ${['csharp', 'python'].filter((l) => engine.hasParser(l)).join(', ')}`);

  // The engine caches parsed targets by path, so every run gets its own directory (a `paths:` glob such
  // as tests/** still applies: Semgrep matches it at any depth, verified against the CLI).
  let runCounter = 0;

  /** Run the rules on several targets ([{path, text}]) in one engine call; reported paths lack the run directory. */
  function executeMany(rulesObj, targets, lang = 'csharp') {
    runCounter += 1;
    const dir = `run-${runCounter}`;
    const rulesPath = `${dir}/rules.json`;
    const seen = new Set(), files = [];
    for (const t of targets || []) {
      const p = sanitizeTargetPath(t && t.path);
      if (seen.has(p)) continue;
      seen.add(p);
      files.push({ path: `${dir}/${p}`, text: String((t && t.text) ?? '') });
    }
    const started = Date.now();
    if (!files.length) return { matches: [], errors: [{ error_type: 'engine', message: 'no target files' }], ms: 0 };
    const origLog = console.log;
    console.log = () => {};
    try {
      mkdirSync(path.join(fsRoot, dir), { recursive: true });
      engine.writeFile(rulesPath, JSON.stringify(rulesObj));
      for (const f of files) {
        mkdirSync(path.dirname(path.join(fsRoot, f.path)), { recursive: true });
        engine.writeFile(f.path, f.text);
      }
      const out = engine.execute(String(lang || 'csharp'), rulesPath, '.', files.map((f) => f.path));
      const parsed = JSON.parse(out);
      return { ...stripRunDir(normalizeEngineOutput(parsed), dir), raw: parsed, ms: Date.now() - started };
    } catch (e) {
      return { matches: [], errors: [{ error_type: 'engine exception', message: describeThrown(e) }], ms: Date.now() - started };
    } finally {
      console.log = origLog;
      for (const p of [rulesPath, ...files.map((f) => f.path)]) { try { engine.deleteFile(p); } catch (_) { /* nothing to clean */ } }
    }
  }

  /** Single-target form: rules on one file's text under the given path. */
  function execute(rulesObj, targetText, targetPath, lang = 'csharp') {
    return executeMany(rulesObj, [{ path: targetPath || 'target.cs', text: targetText }], lang);
  }

  function finish(code = 0) {
    process.chdir(startDir);
    rmSync(fsRoot, { recursive: true, force: true });
    process.exit(code);
  }
  return { engine, execute, executeMany, finish, startDir };
}
