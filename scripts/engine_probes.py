#!/usr/bin/env python3
"""Three-way differential probe of the browser engine against the reference command-line tools.

Each probe runs one rule against one target in every engine that is available and compares the
results. Unlike scripts/semantics_check.mjs, there are no stored expectations: a probe passes when
the vendored browser engine agrees with the reference CLI, so the suite detects divergence rather
than regression. Two families:

  rules   31 rule-syntax probes (regex operators, paths, version constraints, taint options,
          focus lists, message and fix rendering, severities, metavariable-type, ...)
  syntax  29 C# 9-14 language samples, checking the parser accepts modern syntax

Usage:
  python3 scripts/engine_probes.py [rules|syntax|all] [--only SUBSTRING] [--emit PATH] [--quiet]

Engines: the browser build in dist/ (always, via scripts/run_rule.mjs), `semgrep` and `opengrep`
if they are on PATH. Exits non-zero when the browser engine differs from the reference CLI.
"""
import argparse, json, shutil, subprocess, sys, tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

TARGET = """using System;
namespace Probe
{
    class C
    {
        const string KEY = "0123456789abcdef0123456789abcdef";
        void M(string input, int n)
        {
            var a = Foo(input);
            var b = Bar(a);
            Sink(b);
            Sink(Foo("lit"));
            if (n > 5 && input != null) { Baz(n); }
            if (input != null && n > 5) { Baz(n); }
            Use(KEY);
            Console.WriteLine("hello world");
            Console.WriteLine($"hi {input}");
            Check(x: 30);
            Check(x: 10);
            Qux(input);
            Qux(Escape(input));
            string s = "abc" + input;
            Log(s);
            Emit(a, 5);
            Foo(1);
        }
    }
}
"""

HEAD = "rules:\n- id: p\n  languages: [csharp]\n  severity: WARNING\n  message: m\n"
def rule(body, head=HEAD):
    return head + "".join("  " + l + "\n" for l in body.strip("\n").split("\n"))

TAINT_IN = "mode: taint\npattern-sources:\n- pattern: input\n"
RULES = {
 # name: (rule yaml, expectation in current Semgrep)
 "max-version-future":      (rule('max-version: "9.99.0"\npattern: Sink($X)'), "[11, 12]"),
 "max-version-past":        (rule('max-version: "1.0.0"\npattern: Sink($X)'), "[] rule skipped"),
 "min-version-future":      (rule('min-version: "99.0.0"\npattern: Sink($X)'), "[] rule skipped"),
 "focus-metavariable-list": (rule("patterns:\n- pattern: if ($A && $B) { ... }\n- focus-metavariable: [$A, $B]"), "[13, 13, 14, 14]"),
 "message-interpolation":   (rule("pattern: Sink($X)", HEAD.replace("message: m", "message: found $X")), "message 'found b'"),
 "taint-labels":            (rule("mode: taint\npattern-sources:\n- pattern: input\n  label: INPUT\npattern-sinks:\n- pattern: Sink($X)\n  requires: INPUT"), "[11]"),
 "taint-default":           (rule(TAINT_IN + "pattern-sinks:\n- pattern: Sink($X)\n- pattern: Qux($X)"), "[11, 20, 21]"),
 "taint_assume_safe_functions": (rule(TAINT_IN + "pattern-sinks:\n- pattern: Sink($X)\n- pattern: Qux($X)\noptions:\n  taint_assume_safe_functions: true"), "[20]"),
 "taint-sink-exact-true":   (rule(TAINT_IN + "pattern-sinks:\n- pattern: Qux(...)\n  exact: true\noptions:\n  taint_assume_safe_functions: true"), "[]"),
 "taint-sink-exact-false":  (rule(TAINT_IN + "pattern-sinks:\n- pattern: Qux(...)\n  exact: false\noptions:\n  taint_assume_safe_functions: true"), "[20, 21]"),
 "by-side-effect-only":     (rule("mode: taint\npattern-sources:\n- patterns:\n  - pattern: Escape($X)\n  - focus-metavariable: $X\n  by-side-effect: only\npattern-sinks:\n- pattern: Qux($X)\n- pattern: Log($X)"), "[23]"),
 "by-side-effect-true":     (rule("mode: taint\npattern-sources:\n- patterns:\n  - pattern: Escape($X)\n  - focus-metavariable: $X\n  by-side-effect: true\npattern-sinks:\n- pattern: Qux($X)\n- pattern: Log($X)"), "[21, 23]"),
 "symbolic_propagation":    (rule("pattern: Sink(Bar(Foo($X)))\noptions:\n  symbolic_propagation: true"), "[11]"),
 "commutative_boolop":      (rule("pattern: if ($A > 5 && $B != null) { ... }\noptions:\n  commutative_boolop: true"), "[13, 14]"),
 "boolop-default":          (rule("pattern: if ($A > 5 && $B != null) { ... }"), "[13]"),
 "implicit_deep_exprstmt-off": (rule("pattern: Foo($X);\noptions:\n  implicit_deep_exprstmt: false"), "[25]"),
 "deep-exprstmt-default":   (rule("pattern: Foo($X);"), "[9, 12, 25]"),
 "const-field-propagation": (rule('pattern: Use("...")'), "[15]"),
 "metavariable-in-string":  (rule('pattern: Console.WriteLine("hello $X")'), "?"),
 "interpolated-string":     (rule('pattern: Console.WriteLine("...")'), "[16, 17]"),
 "if-call-cond-ellipsis-body": (rule("pattern: if (n > 5 && input != null) { ... }"), "[13]"),
 "severity-CRITICAL":       (rule("pattern: Sink($X)", HEAD.replace("WARNING", "CRITICAL")), "[11, 12]"),
 "metavariable-type":       (rule("patterns:\n- pattern: Qux($X)\n- metavariable-type:\n    metavariable: $X\n    type: string"), "[20]"),
 "paths-exclude":           (rule("paths:\n  exclude: ['target.cs']\npattern: Sink($X)"), "[] file excluded"),
 "metavariable-regex":      (rule("patterns:\n- pattern: 'Check(x: $N)'\n- metavariable-regex:\n    metavariable: $N\n    regex: '^3'"), "[18]"),
 "pattern-not-regex":       (rule("patterns:\n- pattern: 'Check(x: $N)'\n- pattern-not-regex: 'x: 10'"), "[18]"),
 "pattern-regex":           (rule("pattern-regex: 'Check\\(x: 30\\)'"), "[18]"),
 "metavariable-analysis-entropy": (rule("patterns:\n- pattern: const string $N = $S;\n- metavariable-analysis:\n    analyzer: entropy\n    metavariable: $S"), "[6]"),
 "fix-rendered":            (rule("pattern: Sink($X)\nfix: SafeSink($X)"), "fix 'SafeSink(b)'"),
 "metavariable-comparison": (rule("patterns:\n- pattern: 'Check(x: $N)'\n- metavariable-comparison:\n    comparison: $N > 15"), "[18]"),
 "typed-metavariable":      (rule("pattern: Qux((string $X))"), "[20]"),
}

SYNTAX = {
 "cs9-record":                    "using System;\nrecord Person(string Name);\nclass T { void M() { Foo(1); } }\n",
 "cs9-target-typed-new":          "using System.Collections.Generic;\nclass T { void M() { List<int> l = new(); Foo(1); } }\n",
 "cs9-is-not-null-relational":    "class T { void M(object x, int n) { if (x is not null) { } if (n is > 5 and < 10) { } Foo(1); } }\n",
 "cs9-top-level-statements":      "using System;\nFoo(1);\nstatic void Foo(int x) { }\n",
 "cs9-init-and-with":             "record R { public int A { get; init; } }\nclass T { void M(R r) { var r2 = r with { A = 1 }; Foo(1); } }\n",
 "cs10-file-scoped-namespace":    "namespace X;\nclass T { void M() { Foo(1); } }\n",
 "cs10-global-using":             "global using System;\nclass T { void M() { Foo(1); } }\n",
 "cs10-record-struct":            "record struct P(int X, int Y);\nclass T { void M() { Foo(1); } }\n",
 "cs10-extended-property-pattern":"class T { void M(object o) { if (o is { A.B: 1 }) { } Foo(1); } }\n",
 "cs11-raw-string-literal":       'class T { void M() { var s = """\n  raw "quoted" text\n  """; Foo(1); } }\n',
 "cs11-list-pattern":             "class T { void M(int[] arr) { if (arr is [1, .., 3]) { } Foo(1); } }\n",
 "cs11-required-member":          "class A { public required string Name { get; set; } }\nclass T { void M() { Foo(1); } }\n",
 "cs11-generic-attribute":        "class T { [Attr<int>] void M() { Foo(1); } }\n",
 "cs11-utf8-string-literal":      'class T { void M() { var u = "abc"u8; Foo(1); } }\n',
 "cs11-static-abstract-member":   "interface I<T> { static abstract T Zero { get; } }\nclass T { void M() { Foo(1); } }\n",
 "cs11-file-local-type":          "file class Helper { }\nclass T { void M() { Foo(1); } }\n",
 "cs12-primary-constructor":      "class P(int x) { public int X => x; void M() { Foo(1); } }\n",
 "cs12-collection-expression":    "class T { void M(int[] a) { int[] b = [1, 2, 3]; int[] c = [.. a, 4]; Foo(1); } }\n",
 "cs12-alias-any-type":           "using Point = (int x, int y);\nclass T { void M() { Foo(1); } }\n",
 "cs12-lambda-default-parameter": "class T { void M() { var f = (int x = 1) => x; Foo(1); } }\n",
 "cs12-ref-readonly-parameter":   "class T { void N(ref readonly int x) { } void M() { Foo(1); } }\n",
 "cs13-params-span":              "using System;\nclass T { void N(params ReadOnlySpan<int> xs) { } void M() { Foo(1); } }\n",
 "cs13-escape-sequence-e":        'class T { void M() { var e = "\\e"; Foo(1); } }\n',
 "cs13-implicit-index-initializer":"class T { void M() { var b = new Buf { [^1] = 5 }; Foo(1); } }\n",
 "cs13-partial-property":         "partial class Q { public partial int X { get; set; } }\nclass T { void M() { Foo(1); } }\n",
 "cs14-field-keyword":            "class T { public int X { get => field; set => field = value; } void M() { Foo(1); } }\n",
 "cs14-extension-members":        "static class E { extension(int x) { public int Twice => x * 2; } }\nclass T { void M() { Foo(1); } }\n",
 "cs14-null-conditional-assignment":"class T { public int B; void M(T a) { a?.B = 5; Foo(1); } }\n",
 "cs14-nameof-unbound-generic":   "using System.Collections.Generic;\nclass T { void M() { var n = nameof(List<>); Foo(1); } }\n",
}
SYNTAX_RULE = rule("pattern: Foo(1)")

def short_err(e):
    t = e.get("type") or e.get("error_type") or ""
    if isinstance(t, (list, dict)): t = json.dumps(t)
    m = str(e.get("message") or e.get("long_msg") or e.get("short_msg") or "")
    return (str(t) + ": " + m.replace("\n", " "))[:110]

def run_browser(rule_path, target_path):
    """The vendored browser engine, driven through scripts/run_rule.mjs."""
    try:
        p = subprocess.run(["node", "scripts/run_rule.mjs", "--rule", str(rule_path), "--target", str(target_path)],
                           cwd=REPO, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return {"lines": None, "errors": ["timeout (90 s)"], "extra": {}}
    out = p.stdout
    i = out.find("\n{")
    js = out[i + 1:] if i >= 0 else (out if out.startswith("{") else "")
    try:
        d = json.loads(js)
    except Exception:
        return {"lines": None, "errors": [("no JSON: " + (p.stderr or out).strip().replace("\n", " ")[:160])], "extra": {}}
    lines = sorted(((m.get("location") or m).get("start") or {}).get("line", -1) for m in d.get("matches", []))
    first = (d.get("matches") or [{}])[0].get("extra", {}) if d.get("matches") else {}
    return {"lines": lines, "errors": [short_err(e) for e in d.get("errors", [])], "extra": {"message": first.get("message"), "fix": first.get("fix")}}

def run_cli(binary, rule_path, target_path, drop_metrics=False):
    """A native CLI (semgrep or opengrep). Opengrep has no telemetry and rejects --metrics."""
    with tempfile.TemporaryDirectory(prefix="probe-") as tmp:
        shutil.copy(rule_path, Path(tmp) / "rule.yaml"); shutil.copy(target_path, Path(tmp) / "target.cs")
        cmd = [binary, "scan", "--metrics=off", "--quiet", "--json", "--no-git-ignore", "--disable-version-check", "--config", "rule.yaml", "target.cs"]
        if drop_metrics:
            cmd.remove("--metrics=off")
        try:
            p = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return {"lines": None, "errors": ["timeout (120 s)"], "extra": {}}
    try:
        d = json.loads(p.stdout or "{}")
    except Exception:
        return {"lines": None, "errors": ["no JSON: " + (p.stderr.strip().replace("\n", " ")[:160])], "extra": {}}
    res = d.get("results", [])
    lines = sorted(r["start"]["line"] for r in res)
    first = res[0].get("extra", {}) if res else {}
    errs = [short_err(e) for e in d.get("errors", [])]
    if not p.stdout.strip() and p.stderr.strip(): errs.append("stderr: " + p.stderr.strip().replace("\n", " ")[:160])
    return {"lines": lines, "errors": errs, "extra": {"message": first.get("message"), "fix": first.get("fix")}}

def summarise(row, engines):
    """A probe passes when the browser engine matches the reference CLI (lines and error/no-error)."""
    ref = row.get("semgrep") or row.get("opengrep")
    if ref is None:
        return "no-reference"
    b = row["browser"]
    same_lines = b["lines"] == ref["lines"]
    same_errors = bool(b["errors"]) == bool(ref["errors"])
    return "ok" if (same_lines and same_errors) else "DIFFERS"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", nargs="?", default="all", choices=["rules", "syntax", "all"])
    ap.add_argument("--only", help="run only probes whose name contains this substring")
    ap.add_argument("--emit", help="write one JSON object per probe to this file")
    ap.add_argument("--quiet", action="store_true", help="print only differences and the summary")
    args = ap.parse_args(argv)

    engines = {"browser": True,
               "semgrep": shutil.which("semgrep") is not None,
               "opengrep": shutil.which("opengrep") is not None}
    missing = [k for k, v in engines.items() if not v]
    if not engines["semgrep"] and not engines["opengrep"]:
        print("neither `semgrep` nor `opengrep` is on PATH; nothing to compare against", file=sys.stderr)
        return 2
    print("engines: " + ", ".join(k for k, v in engines.items() if v) + (f"  (skipped: {', '.join(missing)})" if missing else ""))

    work = Path(tempfile.mkdtemp(prefix="dojo-probes-"))
    rows, differ = [], 0
    kinds = ["rules", "syntax"] if args.kind == "all" else [args.kind]
    for kind in kinds:
        cases = RULES if kind == "rules" else SYNTAX
        print(f"\n--- {kind} ({len(cases)} probes)")
        if kind == "rules":
            tpath = work / "target.cs"
            tpath.write_text(TARGET)
        for name in cases:
            if args.only and args.only not in name:
                continue
            rpath = work / f"{name}.yaml"
            if kind == "rules":
                rule_text, expected = RULES[name]
            else:
                rule_text, expected = SYNTAX_RULE, "match the line holding Foo(1), no errors"
                tpath = work / f"{name}.cs"
                tpath.write_text(SYNTAX[name])
            rpath.write_text(rule_text)
            row = {"probe": name, "kind": kind, "expected": expected, "browser": run_browser(rpath, tpath)}
            if engines["semgrep"]:
                row["semgrep"] = run_cli("semgrep", rpath, tpath)
            if engines["opengrep"]:
                row["opengrep"] = run_cli("opengrep", rpath, tpath, drop_metrics=True)
            row["verdict"] = summarise(row, engines)
            rows.append(row)
            if row["verdict"] == "DIFFERS":
                differ += 1
            if row["verdict"] == "DIFFERS" or not args.quiet:
                def cell(r):
                    if r is None:
                        return "-"
                    return "lines=" + json.dumps(r["lines"]) + (" ERR" if r["errors"] else "")
                line = f"  {'ok  ' if row['verdict'] == 'ok' else row['verdict']}  {name:34s} browser={cell(row['browser'])}"
                for e in ("semgrep", "opengrep"):
                    if e in row:
                        line += f"  {e}={cell(row[e])}"
                print(line)
                if row["verdict"] == "DIFFERS":
                    for e in ("browser", "semgrep", "opengrep"):
                        if e in row and row[e] and row[e]["errors"]:
                            print(f"        {e} errors: {row[e]['errors'][0][:150]}")

    if args.emit:
        Path(args.emit).parent.mkdir(parents=True, exist_ok=True)
        Path(args.emit).write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
        print(f"\nwrote {args.emit} ({len(rows)} probes)")
    shutil.rmtree(work, ignore_errors=True)
    print(f"\n{len(rows) - differ}/{len(rows)} probes agree with the reference CLI"
          + (f", {differ} differ" if differ else ""))
    return 1 if differ else 0


if __name__ == "__main__":
    sys.exit(main())
