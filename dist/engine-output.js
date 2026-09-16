// Shared by the browser worker and the Node parity script.

/** Describe a value thrown by the engine (JS Error or a raw js_of_ocaml exception array). */
export function describeThrown(e) {
  if (Array.isArray(e)) {
    // raw OCaml exception value, e.g. [0, [248, "Rule.Err", -n], ...payload]
    const parts = [];
    const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (typeof v === 'string') parts.push(v); };
    walk(e);
    return parts.filter((s) => s.length > 1).join(' — ') || 'engine exception';
  }
  if (e && e.stack) return String(e.message || e);
  return String(e);
}

/**
 * The v1.81.0 engine returns Semgrep's CLI JSON (`results`, `errors`). Expose the core-style shape the
 * grader and the UI consume: matches with rule_id / location / extra, errors with error_type / message.
 */
export function normalizeEngineOutput(parsed) {
  const results = Array.isArray(parsed.results) ? parsed.results : parsed.matches || [];
  const matches = results.map((r) => {
    if (r.check_id === undefined) return r;
    const x = r.extra || {};
    return {
      rule_id: r.check_id,
      location: { path: r.path, start: r.start, end: r.end },
      extra: { message: x.message, metavars: x.metavars || {}, fix: x.fix, fixed_lines: x.fixed_lines, severity: x.severity, lines: x.lines },
    };
  });
  const errors = (parsed.errors || []).map((e) => ({
    error_type: e.type !== undefined ? e.type : e.error_type,
    message: e.message !== undefined ? e.message : e.long_msg || e.short_msg || String(e),
    level: e.level, code: e.code, path: e.path, spans: e.spans,
  }));
  return { matches, errors };
}

/** Normalise a target path for the pseudo-filesystem: forward slashes, no leading slashes, no `.` / `..` segments. */
export function sanitizeTargetPath(p, fallback = 'target.cs') {
  const parts = String(p || '').replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..');
  return parts.length ? parts.join('/') : fallback;
}

/**
 * Lay out the targets of one run under `dir`: sanitize each path, drop duplicates (first wins), keep the path
 * the caller gave so the report can use it again. `targets` is [{path, text}]; the result is [{given, path, text}]
 * where `path` is where the file is written. Every run needs its own directory: the engine caches file contents
 * by path for pattern-regex, metavariable-regex and fix rendering, which answer from the previous run's text on a
 * reused path (or throw Invalid_argument: String.sub); plain patterns are unaffected.
 */
export function layoutTargets(targets, dir) {
  const seen = new Set(), files = [];
  for (const t of targets || []) {
    const clean = sanitizeTargetPath(t && t.path);
    if (seen.has(clean)) continue;
    seen.add(clean);
    const raw = t && t.path != null ? String(t.path) : '';
    files.push({ given: raw || clean, path: `${dir}/${clean}`, text: String((t && t.text) ?? '') });
  }
  return files;
}

/** Rewrite the paths the engine reports (and quotes in messages) back to the paths the caller gave (mutates and returns). */
export function restorePaths(result, files) {
  const back = new Map(files.map((f) => [f.path, f.given]));
  const fix = (s) => (typeof s === 'string' && back.has(s) ? back.get(s) : s);
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const written = [...back.keys()].sort((a, b) => b.length - a.length); // longest first, replaced in one pass
  const inText = written.length ? new RegExp(written.map(escapeRe).join('|'), 'g') : null;
  const fixText = (s) => (typeof s === 'string' && inText ? s.replace(inText, (w) => back.get(w)) : s);
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.path === 'string') v.path = fix(v.path);
      if (typeof v.file === 'string') v.file = fix(v.file);
      for (const k of Object.keys(v)) if (k !== 'path' && k !== 'file') walk(v[k]);
    }
  };
  for (const m of result.matches) if (m.location) m.location.path = fix(m.location.path);
  for (const e of result.errors) {
    if (typeof e.path === 'string') e.path = fix(e.path);
    e.message = fixText(e.message);
    walk(e.spans);
    walk(e.error_type);
  }
  return result;
}
