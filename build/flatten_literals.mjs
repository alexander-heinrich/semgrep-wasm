#!/usr/bin/env node
// Caps the nesting depth of array literals in a built bundle. js_of_ocaml emits OCaml lists and constant
// values as nested JavaScript array literals, hundreds of levels deep, and JavaScriptCore's bytecode
// generator recurses once per level: inside a WebKit worker, whose stack holds only ~4 000 frames, the
// C++ parser bundle (318 levels) failed to evaluate with "Maximum call stack size exceeded" while the C#
// bundle (276) still passed. Every literal nested deeper than --depth becomes a flat token list that a
// small helper turns back into the same nested arrays when the bundle loads; element expressions keep
// their left-to-right evaluation order. Usage: node build/flatten_literals.mjs [--depth N] FILE...
// Rewrites in place; a second run is a no-op.
import { readFileSync, writeFileSync } from 'node:fs';
import * as acorn from 'acorn';

const args = process.argv.slice(2);
const at = args.indexOf('--depth');
const LIMIT = at >= 0 ? Number(args[at + 1]) : 24;
const files = at >= 0 ? args.filter((a, i) => i !== at && i !== at + 1) : args;
const HELPER = 'var __nestO={},__nestC={};function __nest(t){var s=[[]],i,v,a;for(i=0;i<t.length;i++){v=t[i];if(v===__nestO)s.push([]);else if(v===__nestC){a=s.pop();s[s.length-1].push(a)}else s[s.length-1].push(v)}return s[0][0]}\n';

const isNode = (v) => v && typeof v === 'object' && typeof v.type === 'string';
const children = (node) => { const out = []; for (const k of Object.keys(node)) { if (k === 'loc' || k === 'range') continue; const v = node[k]; if (Array.isArray(v)) { for (const c of v) if (isNode(c)) out.push(c); } else if (isNode(v)) out.push(v); } return out; };
// an array literal we may take apart: no holes, no spread
const plain = (n) => n.type === 'ArrayExpression' && n.elements.every((e) => e && e.type !== 'SpreadElement');

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const opts = { ecmaVersion: 'latest', sourceType: file.endsWith('.mjs') ? 'module' : 'script', allowHashBang: true };
  if (src.startsWith(HELPER)) { console.log(`${file}: already flattened`); continue; }
  const ast = acorn.parse(src, opts);
  // nesting depth of every array literal: 1 + the deepest array literal anywhere inside it
  const depth = new Map();
  let maxBefore = 0;
  (function measure(node) {
    let d = 0;
    for (const c of children(node)) d = Math.max(d, measure(c));
    if (node.type === 'ArrayExpression') { d += plain(node) ? 1 : 0; depth.set(node, d); if (d > maxBefore) maxBefore = d; }
    return d;
  })(ast);
  // the outermost array literals deeper than the limit, anywhere under `node` (not `node` itself)
  function deepInside(node, out) {
    for (const c of children(node)) {
      if (c.type === 'ArrayExpression' && plain(c) && depth.get(c) > LIMIT) out.push(c);
      else deepInside(c, out);
    }
    return out;
  }
  // source text of a node, with the deep literals inside it flattened
  function render(node) {
    const inner = deepInside(node, []).sort((x, y) => x.start - y.start);
    if (!inner.length) return src.slice(node.start, node.end);
    let s = '', pos = node.start;
    for (const a of inner) { s += src.slice(pos, a.start) + flat(a); pos = a.end; }
    return s + src.slice(pos, node.end);
  }
  function tokens(arr, out) {
    out.push('__nestO');
    for (const el of arr.elements) { if (el.type === 'ArrayExpression' && plain(el)) tokens(el, out); else out.push(render(el)); }
    out.push('__nestC');
  }
  const flat = (arr) => { const out = []; tokens(arr, out); return `__nest([${out.join(',')}])`; };
  const top = deepInside(ast, []).sort((x, y) => x.start - y.start);
  let out = HELPER, pos = 0;
  for (const a of top) { out += src.slice(pos, a.start) + flat(a); pos = a.end; }
  out += src.slice(pos);
  // check the result parses and measure again
  let maxAfter = 0;
  (function measure(node) { let d = 0; for (const c of children(node)) d = Math.max(d, measure(c)); if (node.type === 'ArrayExpression') { d += 1; if (d > maxAfter) maxAfter = d; } return d; })(acorn.parse(out, opts));
  writeFileSync(file, out);
  console.log(`${file}: ${top.length} literal(s) flattened; deepest array nesting ${maxBefore} → ${maxAfter}; ${(src.length / 1e6).toFixed(2)} → ${(out.length / 1e6).toFixed(2)} MB`);
}
