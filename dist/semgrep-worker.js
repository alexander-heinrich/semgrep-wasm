// Example module Web Worker that hosts the engine and runs rules on demand. It lives inside dist/ next to the
// engine files (copy the directory as a whole) and is driven from the main thread with postMessage.
// Protocol: main → {type:'init'}
//                | {type:'run', id, rules, lang?, targets?: [{path, text}], target?, targetPath?}
//                  (`lang` defaults to 'csharp'; `target` + `targetPath` are the single-file form of `targets`)
//           worker → {type:'progress', stage} (while starting, and again when a run loads a parser on demand)
//                    | {type:'ready', timings} | {type:'fatal', message}
//                    | {type:'result', id, matches, errors, ms} | {type:'log', message}
// Reported paths are exactly the target paths the caller gave.
import { normalizeEngineOutput, describeThrown, layoutTargets, restorePaths } from './engine-output.js';

const VENDOR = new URL('./', import.meta.url);
const ENGINE_URL = new URL('engine-1.81.0.mjs', VENDOR).href;
// Parsers by language; `serves` names the other engine languages the same parser handles. C# and Python load at
// start (Python also parses metavariable-comparison expressions); the others load the first time a run needs them.
const PARSERS = {
  csharp: { mjs: 'csharp-1.81.0.mjs', wasm: 'csharp-1.81.0.wasm' },
  python: { mjs: 'python-1.81.0.mjs', wasm: 'python-1.81.0.wasm' },
  cpp: { mjs: 'cpp-1.81.0.mjs', wasm: 'cpp-1.81.0.wasm', serves: ['c'] },
};
const EAGER = ['csharp', 'python'];
const PARSER_FOR = {};
for (const [key, p] of Object.entries(PARSERS)) { PARSER_FOR[key] = key; for (const l of p.serves || []) PARSER_FOR[l] = key; }

const post = (m) => self.postMessage(m);

let engine = null;
let ready = false;
let runCounter = 0;
const loading = new Map(); // parser key → promise of its registration

function loadParser(key) {
  if (!loading.has(key)) {
    loading.set(key, (async () => {
      post({ type: 'progress', stage: key });
      const spec = PARSERS[key];
      const mod = await import(new URL(spec.mjs, VENDOR).href);
      engine.addParser(await mod.ParserFactory(new URL(spec.wasm, VENDOR).href));
    })().catch((e) => { loading.delete(key); throw e; }));
  }
  return loading.get(key);
}

async function init() {
  const timings = {};
  const t0 = performance.now();
  try {
    post({ type: 'progress', stage: 'engine' });
    const eng = await import(ENGINE_URL);
    engine = await eng.EngineFactory();
    timings.engine = Math.round(performance.now() - t0);
    for (const key of EAGER) {
      try {
        await loadParser(key);
        timings[key] = Math.round(performance.now() - t0);
      } catch (e) {
        if (key === 'csharp') throw e;
        post({ type: 'log', message: key + ' parser unavailable: ' + describeThrown(e).slice(0, 200) });
      }
    }
    if (typeof engine.writeFile !== 'function' || typeof engine.execute !== 'function') throw new Error('unexpected engine API');
    ready = true;
    post({ type: 'ready', timings });
  } catch (e) {
    post({ type: 'fatal', message: describeThrown(e) });
  }
}

async function run({ id, rules, lang = 'csharp', targets, target, targetPath }) {
  const reply = (matches, errors, started) => post({ type: 'result', id, matches, errors, ms: started ? Math.round(performance.now() - started) : 0 });
  if (!ready) { reply([], [{ error_type: 'engine', message: 'engine not ready' }]); return; }
  lang = String(lang || 'csharp');
  const key = PARSER_FOR[lang];
  if (key) {
    try { await loadParser(key); } catch (e) { reply([], [{ error_type: 'engine', message: `cannot load the ${lang} parser: ` + describeThrown(e) }]); return; }
  }
  // Every run gets its own directory (the engine caches file contents by path, see layoutTargets); reported
  // paths are mapped back to the names given. Relative paths resolve against the pseudo-filesystem's working
  // directory, and a `paths:` glob such as tests/** still applies because Semgrep matches it at any depth.
  runCounter += 1;
  const dir = `run-${runCounter}`;
  const rulesPath = `${dir}/rules.json`;
  const files = layoutTargets(Array.isArray(targets) ? targets : [{ path: targetPath, text: target }], dir);
  const started = performance.now();
  if (!files.length) { reply([], [{ error_type: 'engine', message: 'no target files' }], started); return; }
  const origLog = console.log;
  console.log = () => {};
  try {
    engine.writeFile(rulesPath, JSON.stringify({ rules }));
    for (const f of files) engine.writeFile(f.path, f.text);
    const out = engine.execute(lang, rulesPath, '.', files.map((f) => f.path));
    const { matches, errors } = restorePaths(normalizeEngineOutput(JSON.parse(out)), files);
    reply(matches, errors, started);
  } catch (e) {
    reply([], [{ error_type: 'rule error', message: describeThrown(e) }], started);
  } finally {
    console.log = origLog;
    for (const p of [rulesPath, ...files.map((f) => f.path)]) { try { engine.deleteFile(p); } catch (_) { /* nothing to clean */ } }
  }
}

let queue = Promise.resolve();
self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'init') init();
  else if (m.type === 'run') queue = queue.then(() => run(m)); // one run at a time: a parser may still be loading
};
