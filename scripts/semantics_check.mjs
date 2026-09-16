#!/usr/bin/env node
// Runs the semantics suite (tests/semantics.json, expectations = current Semgrep CLI) through the browser
// engine and lists every divergence. Usage: node scripts/semantics_check.mjs [--only NAME] [--dump NAME]
// A case may set `lang` (default csharp; picks the default target) and either `target`/`targetPath` or
// `targets: [{path, text | file}]` — in the multi-target form `expect` maps each path to its matched lines.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../dist/engine-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const argValue = (name) => (args.find((a) => a.startsWith(`${name}=`)) || '').slice(name.length + 1) || (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const only = argValue('--only');
const dump = argValue('--dump');
const suite = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'semantics.json'), 'utf8'));
const DEFAULTS = {
  csharp: { text: readFileSync(path.join(ROOT, 'tests', 'target.cs'), 'utf8'), path: 'Demo/Svc.cs' },
  python: { text: readFileSync(path.join(ROOT, 'tests', 'target.py'), 'utf8'), path: 'app/main.py' },
};
const sortedLines = (ms) => [...new Set(ms.map((m) => m.location.start.line))].sort((a, b) => a - b);
const byPath = (ms) => Object.fromEntries([...new Set(ms.map((m) => m.location.path))].sort().map((p) => [p, sortedLines(ms.filter((m) => m.location.path === p))]));
const sortedKeys = (o) => Object.fromEntries(Object.keys(o || {}).sort().map((k) => [k, o[k]]));

const { execute, executeMany, finish } = await loadEngine();
let pass = 0, fail = 0;
for (const test of suite) {
  if (only && test.name !== only) continue;
  const lang = test.lang || 'csharp';
  const dflt = DEFAULTS[lang] || DEFAULTS.csharp;
  const rule = Object.assign({ id: test.id || 'r', message: 'm', languages: [lang], severity: 'WARNING' }, test.rule);
  let res, got, want;
  if (Array.isArray(test.targets)) {
    const targets = test.targets.map((t) => ({ path: t.path, text: t.file ? readFileSync(path.join(ROOT, 'tests', t.file), 'utf8') : t.text }));
    res = executeMany({ rules: [rule] }, targets, lang);
    got = byPath(res.matches); want = sortedKeys(test.expect);
  } else {
    res = execute({ rules: [rule] }, test.target || dflt.text, test.targetPath || dflt.path, lang);
    got = sortedLines(res.matches); want = test.expect;
  }
  const lines = got;
  const errs = res.errors.map((e) => `${e.error_type || ''}:${String(e.message || '').split('\n')[0].slice(0, 100)}`);
  let status;
  if (test.expectError) status = errs.length ? 'ok(err)' : 'FAIL(no error)';
  else if (JSON.stringify(got) === JSON.stringify(want)) status = 'ok';
  else status = 'FAIL';
  if (status.startsWith('ok')) pass++; else fail++;
  const extra = [];
  if (test.checkFix && res.matches.length) extra.push(`fix=${JSON.stringify(res.matches[0].extra.fix ?? res.matches[0].extra.fixed_lines ?? null)}`);
  if (test.showMetavars && res.matches.length) extra.push(`metavars=${Object.keys(res.matches[0].extra.metavars || {}).join(',') || 'none'}`);
  console.log(`[${status.padEnd(13)}] ${test.name.padEnd(34)} got=${JSON.stringify(lines)} want=${JSON.stringify(test.expect ?? 'error')} ${res.ms}ms${errs.length ? ' errors=' + JSON.stringify(errs).slice(0, 160) : ''}${extra.length ? ' ' + extra.join(' ') : ''}`);
  if (dump === test.name && res.raw) console.log(JSON.stringify(res.raw).slice(0, 3000));
}
console.log(`\n${pass} passed, ${fail} failed`);
finish(fail ? 1 : 0);
