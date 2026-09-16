// Example module Web Worker that hosts the engine and runs rules on demand. It lives inside dist/ next to the
// engine files (copy the directory as a whole) and is driven from the main thread with postMessage.
// Protocol: main → {type:'init'}
//                | {type:'run', id, rules, lang?, targets?: [{path, text}], target?, targetPath?}
//                  (`lang` defaults to 'csharp'; `target` + `targetPath` are the single-file form of `targets`)
//           worker → {type:'progress', stage} | {type:'ready', timings} | {type:'fatal', message}
//                    | {type:'result', id, matches, errors, ms} | {type:'log', message}
// Reported paths are exactly the target paths the caller gave.
import { normalizeEngineOutput, describeThrown, layoutTargets, restorePaths } from './engine-output.js';

const VENDOR = new URL('./', import.meta.url);
const ENGINE_URL = new URL('engine-1.81.0.mjs', VENDOR).href;
const CSHARP_URL = new URL('csharp-1.81.0.mjs', VENDOR).href;
const CSHARP_WASM_URL = new URL('csharp-1.81.0.wasm', VENDOR).href;
const PYTHON_URL = new URL('python-1.81.0.mjs', VENDOR).href;
const PYTHON_WASM_URL = new URL('python-1.81.0.wasm', VENDOR).href;

const post = (m) => self.postMessage(m);

let engine = null;
let ready = false;
let runCounter = 0;

async function init() {
  const timings = {};
  const t0 = performance.now();
  try {
    post({ type: 'progress', stage: 'engine' });
    const eng = await import(ENGINE_URL);
    engine = await eng.EngineFactory();
    timings.engine = Math.round(performance.now() - t0);
    post({ type: 'progress', stage: 'csharp' });
    const cs = await import(CSHARP_URL);
    engine.addParser(await cs.ParserFactory(CSHARP_WASM_URL));
    timings.csharp = Math.round(performance.now() - t0);
    post({ type: 'progress', stage: 'python' });
    try {
      // needed for metavariable-comparison (the comparison expression is parsed as Python) and for Python targets
      const py = await import(PYTHON_URL);
      engine.addParser(await py.ParserFactory(PYTHON_WASM_URL));
      timings.python = Math.round(performance.now() - t0);
    } catch (e) {
      post({ type: 'log', message: 'python parser unavailable: ' + describeThrown(e).slice(0, 200) });
    }
    if (typeof engine.writeFile !== 'function' || typeof engine.execute !== 'function') throw new Error('unexpected engine API');
    ready = true;
    post({ type: 'ready', timings });
  } catch (e) {
    post({ type: 'fatal', message: describeThrown(e) });
  }
}

function run({ id, rules, lang = 'csharp', targets, target, targetPath }) {
  if (!ready) { post({ type: 'result', id, matches: [], errors: [{ error_type: 'engine', message: 'engine not ready' }], ms: 0 }); return; }
  // Every run gets its own directory (the engine caches file contents by path, see layoutTargets); reported
  // paths are mapped back to the names given. Relative paths resolve against the pseudo-filesystem's working
  // directory, and a `paths:` glob such as tests/** still applies because Semgrep matches it at any depth.
  runCounter += 1;
  const dir = `run-${runCounter}`;
  const rulesPath = `${dir}/rules.json`;
  const files = layoutTargets(Array.isArray(targets) ? targets : [{ path: targetPath, text: target }], dir);
  const started = performance.now();
  const reply = (matches, errors) => post({ type: 'result', id, matches, errors, ms: Math.round(performance.now() - started) });
  if (!files.length) { reply([], [{ error_type: 'engine', message: 'no target files' }]); return; }
  const origLog = console.log;
  console.log = () => {};
  try {
    engine.writeFile(rulesPath, JSON.stringify({ rules }));
    for (const f of files) engine.writeFile(f.path, f.text);
    const out = engine.execute(String(lang || 'csharp'), rulesPath, '.', files.map((f) => f.path));
    const { matches, errors } = restorePaths(normalizeEngineOutput(JSON.parse(out)), files);
    reply(matches, errors);
  } catch (e) {
    reply([], [{ error_type: 'rule error', message: describeThrown(e) }]);
  } finally {
    console.log = origLog;
    for (const p of [rulesPath, ...files.map((f) => f.path)]) { try { engine.deleteFile(p); } catch (_) { /* nothing to clean */ } }
  }
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'init') init();
  else if (m.type === 'run') run(m);
};
