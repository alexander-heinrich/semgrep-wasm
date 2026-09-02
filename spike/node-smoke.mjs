// Spike harness: load a Semgrep WASM engine + C# parser pair and run a micro-suite.
// Usage: node spike/node-smoke.mjs <engine.mjs> <csharp.mjs> [--shim] [--json-rules]
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// The bundles detect Node and call require('fs'); give the ESM shim a real require.
globalThis.require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const enginePath = args[0];
const parserPath = args[1];
const useShim = args.includes('--shim');
const jsonRules = args.includes('--json-rules');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const skip = ((args.find((a) => a.startsWith('--skip=')) || '').slice(7)).split(',').filter(Boolean);
const dump = (args.find((a) => a.startsWith('--dump=')) || '').slice(7);

const here = path.dirname(new URL(import.meta.url).pathname);
const target = readFileSync(path.join(here, 'target.cs'), 'utf8');
const suite = JSON.parse(readFileSync(path.join(here, 'semantics.json'), 'utf8'));

function yamlToJson(yaml) {
  // Minimal: the suite stores rules as JSON objects already; yaml text is derived for display only.
  return yaml;
}

import { installJsooRuntimeShim } from './jsoo-shims.mjs';
if (args.includes('--stub-runtime')) installJsooRuntimeShim(globalThis, (m) => console.log(m));
const t0 = Date.now();
const load = async (p) => (p.endsWith('.cjs') ? globalThis.require(path.resolve(p)) : await import(pathToFileURL(p).href));
const { EngineFactory } = await load(enginePath);
const engine = await EngineFactory();
const createFileAfterEngine = globalThis.jsoo_create_file;
const t1 = Date.now();
// Replace the bundles' fatal handler so an OCaml exception is dumped with its payload (file/line).
if (args.includes('--dump-exn')) {
  const { inspect } = await import('node:util');
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', inspect(e, { depth: 10, maxArrayLength: 50 })); console.log(e && e.stack); process.exit(3); });
}
const { ParserFactory } = await load(parserPath);
let parser = await ParserFactory();
const t2 = Date.now();
console.log(`engine keys: ${Object.keys(engine).join(', ')}`);
console.log(`parser keys: ${Object.keys(parser).join(', ')}`);
console.log(`load: engine ${t1 - t0} ms, parser ${t2 - t1} ms`);

if (useShim) {
  const p = parser;
  parser = {
    setMountpoints: (m) => p.setMountPoints(m),
    setMountPoints: (m) => p.setMountPoints(m),
    getLangs: () => [p.getLang()],
    getLang: () => p.getLang(),
    parsePattern: (printErrors, lang, str) => p.parsePattern(printErrors, str),
    parseTarget: (lang, file) => p.parseTarget(file),
  };
}
engine.addParser(parser);
// Optional extra parser (e.g. @semgrep/lang-python) with an adaptive shim between engine API generations.
const extra = (args.find((a) => a.startsWith('--extra-parser=')) || '').slice(15);
if (extra) {
  const [ppath, wasm] = extra.split(':');
  const mod = await load(ppath);
  const raw = await mod.ParserFactory(wasm ? path.resolve(wasm) : undefined);
  console.log(`extra parser keys: ${Object.keys(raw).join(', ')}`);
  const newStyle = typeof raw.getLangs === 'function';
  const adapted = newStyle ? {
    setMountPoints: (m) => raw.setMountpoints(m),
    getLang: () => raw.getLangs()[0],
    parsePattern: (printErrors, str) => raw.parsePattern(printErrors, raw.getLangs()[0], str),
    parseTarget: (file) => raw.parseTarget(raw.getLangs()[0], file),
  } : raw;
  try { engine.addParser(adapted); console.log(`extra parser registered for lang ${adapted.getLang()}`); }
  catch (e) { console.log('extra parser failed: ' + String(e).slice(0, 200)); }
}
const csharpLang = engine.lookupLang('csharp');
console.log(`lookupLang('csharp') = ${csharpLang}, hasParser = ${engine.hasParser(csharpLang)}`);

const createFile = globalThis.jsoo_create_file || createFileAfterEngine;
if (!createFile && !engine.writeFile) {
  console.error('No way to create files (no jsoo_create_file global, no engine.writeFile)');
  process.exit(2);
}
import { mkdirSync, writeFileSync } from 'node:fs';
// In Node the jsoo runtime mounts the real filesystem at '/', so write real files under spike/tmp/fs.
const fsRoot = path.join(here, 'tmp', 'fs');
function writeFile(p, content) {
  if (args.includes('--fake-fs')) { if (engine.writeFile) engine.writeFile(p, content); else createFile(p, content); return; }
  const real = path.join(fsRoot, p);
  mkdirSync(path.dirname(real), { recursive: true });
  writeFileSync(real, content);
}
const realPath = (p) => (args.includes('--fake-fs') ? p : path.join(fsRoot, p));

let n = 0;
function run(ruleObj, targetText, targetPath = 'Demo/Svc.cs') {
  n += 1;
  const prefix = `/run/${n}/`;
  const rulesPath = prefix + (jsonRules ? 'rules.json' : 'rules.yaml');
  const rulesText = jsonRules ? JSON.stringify({ rules: [ruleObj] }) : toYaml({ rules: [ruleObj] });
  writeFile(rulesPath, rulesText);
  writeFile(prefix + targetPath, targetText);
  const started = Date.now();
  let out;
  const origLog = console.log;
  console.log = () => {}; // the alpha engines log every ctypes call
  try {
    out = engine.execute('csharp', realPath(rulesPath), realPath(prefix + targetPath));
  } catch (e) {
    console.log = origLog;
    return { fatal: String(e && e.message ? e.message : e), ms: Date.now() - started };
  } finally {
    console.log = origLog;
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    return { fatal: 'non-JSON output: ' + String(out).slice(0, 200), ms: Date.now() - started };
  }
  const matches = parsed.matches || parsed.results || [];
  const errors = parsed.errors || [];
  const lines = matches.map((m) => (m.location ? m.location.start.line : m.start.line));
  return { matches, errors, lines: [...new Set(lines)].sort((a, b) => a - b), ms: Date.now() - started, raw: parsed };
}

// Tiny YAML emitter sufficient for rule objects (strings, numbers, booleans, arrays, objects).
function toYaml(v, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return v.map((x) => {
      if (x !== null && typeof x === 'object') {
        const inner = toYaml(x, indent + 2);
        return `${pad}- ${inner.trimStart()}`;
      }
      return `${pad}- ${scalar(x)}`;
    }).join('\n');
  }
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).map(([k, x]) => {
      if (x !== null && typeof x === 'object') {
        if (Array.isArray(x) && x.length === 0) return `${pad}${k}: []`;
        return `${pad}${k}:\n${toYaml(x, indent + 2)}`;
      }
      return `${pad}${k}: ${scalar(x)}`;
    }).join('\n');
  }
  return scalar(v);
}
function scalar(x) {
  if (typeof x === 'string') {
    if (x.includes('\n')) return '|\n' + x.split('\n').map((l) => '      ' + l).join('\n');
    return JSON.stringify(x);
  }
  return String(x);
}

let pass = 0, fail = 0;
for (const test of suite) {
  if (only && test.name !== only) continue;
  if (skip.includes(test.name)) continue;
  const rule = Object.assign({ id: test.id || 'r', message: 'm', languages: ['csharp'], severity: 'WARNING' }, test.rule);
  const res = run(rule, test.target ? test.target : target, test.targetPath);
  const errs = (res.errors || []).map((e) => `${e.error_type || e.type || ''}:${(e.message || '').split('\n')[0].slice(0, 100)}`);
  let status;
  if (res.fatal) status = 'FATAL';
  else if (test.expectError) status = errs.length ? 'ok(err)' : 'FAIL(no error)';
  else if (JSON.stringify(res.lines) === JSON.stringify(test.expect)) status = 'ok';
  else status = 'FAIL';
  if (status.startsWith('ok')) pass++; else fail++;
  const extra = [];
  if (test.checkFix && res.matches && res.matches.length) {
    const m = res.matches[0];
    extra.push(`fix=${JSON.stringify((m.extra && (m.extra.fix || m.extra.fixed_lines)) || (m.fix) || null)}`);
  }
  if (test.showMetavars && res.matches && res.matches.length) {
    const mv = res.matches[0].extra && res.matches[0].extra.metavars;
    extra.push(`metavars=${mv ? Object.keys(mv).join(',') : 'none'}`);
  }
  console.log(`[${status.padEnd(13)}] ${test.name.padEnd(34)} got=${JSON.stringify(res.lines || [])} want=${JSON.stringify(test.expect || 'error')} ${res.ms}ms ${errs.length ? 'errors=' + JSON.stringify(errs) : ''} ${res.fatal ? 'fatal=' + res.fatal.slice(0, 200) : ''} ${extra.join(' ')}`);
  if ((process.env.DUMP || dump === test.name) && res.raw) console.log(JSON.stringify(res.raw).slice(0, 2500));
}
console.log(`\n${pass} passed, ${fail} failed`);
