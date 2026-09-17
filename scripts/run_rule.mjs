#!/usr/bin/env node
// Run one rule file against one target through the browser engine (Node build) and print the result as JSON.
// The target is parsed as C# unless --lang says otherwise; --target-path is the name the rule's `paths:` see (default: the file's basename).
// This is the engine's smallest usable surface: no grading, no challenge data — just rules in, findings out.
//
// Usage: node scripts/run_rule.mjs --rule rule.yaml --target file.cs [--target-path Some/Path.cs] [--lang csharp|python] [--verbose]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { pathToFileURL } from 'node:url';
// SEMGREP_WASM_DIST points at another copy of dist/ (used to compare builds)
const DIST = process.env.SEMGREP_WASM_DIST ? pathToFileURL(path.resolve(process.env.SEMGREP_WASM_DIST) + '/') : new URL('../dist/', import.meta.url);
const { loadEngine } = await import(new URL('engine-node.mjs', DIST).href);

const args = process.argv.slice(2);
const argValue = (name) => (args.find((a) => a.startsWith(`${name}=`)) || '').slice(name.length + 1) || (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const rulePath = argValue('--rule');
const targetPath = argValue('--target');
if (!rulePath || !targetPath) {
  console.error('usage: node scripts/run_rule.mjs --rule rule.yaml --target file.cs [--target-path Some/Path.cs] [--lang csharp|python]');
  process.exit(2);
}
const rules = yaml.load(readFileSync(path.resolve(rulePath), 'utf8'));
const target = readFileSync(path.resolve(targetPath), 'utf8');

const { execute, finish } = await loadEngine({ verbose: args.includes('--verbose') });
const res = execute(rules, target, argValue('--target-path') || path.basename(targetPath), argValue('--lang') || 'csharp');
console.log(JSON.stringify({ matches: res.matches, errors: res.errors, ms: res.ms }, null, 1));
finish(0);
