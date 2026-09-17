#!/usr/bin/env node
// Runs the semantics suite (tests/semantics.json, expectations = current Semgrep CLI) through the browser
// engine and lists every divergence. Usage: node scripts/semantics_check.mjs [--only NAME] [--dump NAME] [--emit PATH]
// --emit writes every case's full result (matches with ranges, metavariables, fixes; errors) as JSON, for comparing builds.
// A case may set `lang` (default csharp; picks the default target) and either `target`/`targetPath` or
// `targets: [{path, text | file}]` — in the multi-target form `expect` maps each path to its matched lines and
// `expectErrors` lists the paths that must appear in an error. `before: {target, targetPath?}` runs the rule on other
// content at the same path first; the case then checks that nothing of it leaks into the real run.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// SEMGREP_WASM_DIST points the suite at another copy of dist/ (used to compare builds)
const DIST = process.env.SEMGREP_WASM_DIST ? pathToFileURL(path.resolve(process.env.SEMGREP_WASM_DIST) + '/') : new URL('../dist/', import.meta.url);
const { loadEngine } = await import(new URL('engine-node.mjs', DIST).href);

const args = process.argv.slice(2);
const argValue = (name) => (args.find((a) => a.startsWith(`${name}=`)) || '').slice(name.length + 1) || (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const only = argValue('--only');
const dump = argValue('--dump');
const emit = argValue('--emit');
const emitted = [];
const suite = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'semantics.json'), 'utf8'));
const DEFAULTS = {
  csharp: { text: readFileSync(path.join(ROOT, 'tests', 'target.cs'), 'utf8'), path: 'Demo/Svc.cs' },
  python: { text: readFileSync(path.join(ROOT, 'tests', 'target.py'), 'utf8'), path: 'app/main.py' },
  cpp: { text: readFileSync(path.join(ROOT, 'tests', 'target.cpp'), 'utf8'), path: 'src/main.cpp' },
  c: { text: readFileSync(path.join(ROOT, 'tests', 'target.c'), 'utf8'), path: 'src/main.c' },
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
  if (test.before) execute({ rules: [rule] }, test.before.target, test.before.targetPath || test.targetPath || dflt.path, lang);
  if (Array.isArray(test.targets)) {
    const targets = test.targets.map((t) => ({ path: t.path, text: t.file ? readFileSync(path.join(ROOT, 'tests', t.file), 'utf8') : t.text }));
    res = executeMany({ rules: [rule] }, targets, lang);
    got = byPath(res.matches); want = sortedKeys(test.expect);
  } else {
    res = execute({ rules: [rule] }, test.target || dflt.text, test.targetPath || dflt.path, lang);
    got = sortedLines(res.matches); want = test.expect;
  }
  const errs = res.errors.map((e) => `${Array.isArray(e.error_type) ? e.error_type[0] : e.error_type || ''}:${String(e.message || '').split('\n')[0].slice(0, 100)}`);
  let status;
  if (test.expectError) status = errs.length ? 'ok(err)' : 'FAIL(no error)';
  else if (JSON.stringify(got) !== JSON.stringify(want)) status = 'FAIL';
  else if (test.expectErrors && !test.expectErrors.every((p) => res.errors.some((e) => e.path === p))) status = 'FAIL(errors)';
  else status = 'ok';
  if (status.startsWith('ok')) pass++; else fail++;
  const extra = [];
  if (test.checkFix && res.matches.length) extra.push(`fix=${JSON.stringify(res.matches[0].extra.fix ?? res.matches[0].extra.fixed_lines ?? null)}`);
  if (test.showMetavars && res.matches.length) extra.push(`metavars=${Object.keys(res.matches[0].extra.metavars || {}).join(',') || 'none'}`);
  console.log(`[${status.padEnd(13)}] ${test.name.padEnd(34)} got=${JSON.stringify(got)} want=${JSON.stringify(test.expect ?? 'error')} ${res.ms}ms${errs.length ? ' errors=' + JSON.stringify(errs).slice(0, 160) : ''}${extra.length ? ' ' + extra.join(' ') : ''}`);
  if (dump === test.name && res.raw) console.log(JSON.stringify(res.raw).slice(0, 3000));
  if (emit) emitted.push({ name: test.name, status, ms: res.ms, matches: res.matches.map((m) => ({ rule_id: m.rule_id, path: m.location.path, start: m.location.start, end: m.location.end, message: m.extra.message, fix: m.extra.fix, metavars: Object.fromEntries(Object.entries(m.extra.metavars || {}).map(([k, v]) => [k, v.abstract_content])) })), errors: res.errors.map((e) => ({ type: Array.isArray(e.error_type) ? e.error_type[0] : e.error_type, path: e.path, message: e.message })) });
}
if (emit) writeFileSync(emit, JSON.stringify(emitted, null, 1) + '\n');
console.log(`\n${pass} passed, ${fail} failed`);
finish(fail ? 1 : 0);
