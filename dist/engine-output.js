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
