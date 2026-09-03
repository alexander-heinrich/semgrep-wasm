#!/usr/bin/env node
// Runs the spike's semantics micro-suite (spike/semantics.json, expectations = current Semgrep CLI) through
// the vendored browser engine and lists every divergence. Usage: node scripts/semantics_check.mjs [--only NAME] [--dump NAME]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEngine, ROOT } from './lib/engine-node.mjs';

const args = process.argv.slice(2);
const argValue = (name) => (args.find((a) => a.startsWith(`${name}=`)) || '').slice(name.length + 1) || (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const only = argValue('--only');
const dump = argValue('--dump');
const suite = JSON.parse(readFileSync(path.join(ROOT, 'spike', 'semantics.json'), 'utf8'));
const defaultTarget = readFileSync(path.join(ROOT, 'spike', 'target.cs'), 'utf8');

const { execute, finish } = await loadEngine();
let pass = 0, fail = 0;
for (const test of suite) {
  if (only && test.name !== only) continue;
  const rule = Object.assign({ id: test.id || 'r', message: 'm', languages: ['csharp'], severity: 'WARNING' }, test.rule);
  const res = execute({ rules: [rule] }, test.target || defaultTarget, test.targetPath || 'Demo/Svc.cs');
  const lines = [...new Set(res.matches.map((m) => m.location.start.line))].sort((a, b) => a - b);
  const errs = res.errors.map((e) => `${e.error_type || ''}:${String(e.message || '').split('\n')[0].slice(0, 100)}`);
  let status;
  if (test.expectError) status = errs.length ? 'ok(err)' : 'FAIL(no error)';
  else if (JSON.stringify(lines) === JSON.stringify(test.expect)) status = 'ok';
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
