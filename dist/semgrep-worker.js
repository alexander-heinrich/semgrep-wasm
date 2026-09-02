// Module Web Worker that hosts the Semgrep WASM engine (2023 snapshot) and runs rules on demand.
// Protocol: main → {type:'init'} | {type:'run', id, rules, target, targetPath}
//           worker → {type:'progress', stage} | {type:'ready', timings} | {type:'fatal', message}
//                    | {type:'result', id, matches, errors, ms} | {type:'log', message}
import { installJsooRuntimeShim } from './jsoo-shims.mjs';

const VENDOR = new URL('../vendor/semgrep/', import.meta.url);
const ENGINE_URL = new URL('engine-1.17.1-alpha.2.mjs', VENDOR).href;
const CSHARP_URL = new URL('csharp-1.17.1-alpha.0.mjs', VENDOR).href;
const PYTHON_URL = new URL('python-0.0.4.mjs', VENDOR).href;
const PYTHON_WASM_URL = new URL('semgrep-parser.wasm', VENDOR).href;

const post = (m) => self.postMessage(m);
installJsooRuntimeShim(self, () => {});

// Emscripten resolves the Python parser's side-car wasm relative to this worker's URL; redirect it.
const origFetch = self.fetch.bind(self);
self.fetch = (u, ...rest) => origFetch(String(u).endsWith('semgrep-parser.wasm') ? PYTHON_WASM_URL : u, ...rest);

let engine = null;
let runCounter = 0;
let ready = false;

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
    engine.addParser(await cs.ParserFactory());
    timings.csharp = Math.round(performance.now() - t0);
    post({ type: 'progress', stage: 'python' });
    try {
      const py = await import(PYTHON_URL);
      const raw = await py.ParserFactory();
      const lang = raw.getLangs()[0];
      engine.addParser({
        setMountPoints: (m) => raw.setMountpoints(m),
        getLang: () => lang,
        parsePattern: (printErrors, s) => raw.parsePattern(printErrors, lang, s),
        parseTarget: (f) => raw.parseTarget(lang, f),
      });
      timings.python = Math.round(performance.now() - t0);
    } catch (e) {
      // metavariable-comparison will fail without it, everything else works
      post({ type: 'log', message: 'python parser unavailable: ' + String(e).slice(0, 200) });
    }
    if (typeof self.jsoo_create_file !== 'function') throw new Error('jsoo_create_file is not available');
    ready = true;
    post({ type: 'ready', timings });
  } catch (e) {
    post({ type: 'fatal', message: describeThrown(e) });
  }
}

function describeThrown(e) {
  if (Array.isArray(e)) {
    // OCaml exception value, e.g. [0, [248, "Rule.Err", -n], ...payload]
    const parts = [];
    const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (typeof v === 'string') parts.push(v); };
    walk(e);
    const text = parts.filter((s) => s.length > 1 && !/^\/static\//.test(s)).join(' — ');
    return text || 'engine exception';
  }
  if (e && e.stack) return String(e.message || e);
  return String(e);
}

function run({ id, rules, target, targetPath }) {
  if (!ready) { post({ type: 'result', id, matches: [], errors: [{ error_type: 'engine', message: 'engine not ready' }], ms: 0 }); return; }
  runCounter += 1;
  const prefix = `/static/run/${runCounter}/`;
  const rulesPath = prefix + 'rules.json';
  const tPath = prefix + (targetPath || 'target.cs').replace(/^\/+/, '');
  const started = performance.now();
  const origLog = console.log;
  console.log = () => {}; // the alpha engine logs every ctypes call
  try {
    self.jsoo_create_file(rulesPath, JSON.stringify({ rules }));
    self.jsoo_create_file(tPath, target);
    const out = engine.execute('csharp', rulesPath, tPath);
    const parsed = JSON.parse(out);
    post({ type: 'result', id, matches: parsed.matches || [], errors: parsed.errors || [], ms: Math.round(performance.now() - started) });
  } catch (e) {
    post({ type: 'result', id, matches: [], errors: [{ error_type: 'rule error', message: describeThrown(e) }], ms: Math.round(performance.now() - started) });
  } finally {
    console.log = origLog;
  }
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'init') init();
  else if (m.type === 'run') run(m);
};
