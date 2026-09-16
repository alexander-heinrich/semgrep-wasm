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

/** Every run writes its files under `dir/`; remove that prefix from the paths the engine reports (mutates and returns). */
export function stripRunDir(result, dir) {
  const prefix = dir + '/';
  const strip = (s) => (typeof s === 'string' ? s.split(prefix).join('') : s);
  for (const m of result.matches) if (m.location) m.location.path = strip(m.location.path);
  for (const e of result.errors) {
    if (e.path !== undefined) e.path = strip(e.path);
    e.message = strip(e.message);
    if (Array.isArray(e.spans)) for (const s of e.spans) if (s && typeof s.file === 'string') s.file = strip(s.file);
  }
  return result;
}
