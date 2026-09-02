#!/usr/bin/env python3
"""Run every semantics.json test in its own node process (memory cap + timeout) and print one line each."""
import json, subprocess, sys, os, shutil
here = os.path.dirname(os.path.abspath(__file__))
engine, parser = sys.argv[1], sys.argv[2]
extra = sys.argv[3:]
tests = json.load(open(os.path.join(here, 'semantics.json')))
shutil.rmtree(os.path.join(here, 'tmp', 'fs'), ignore_errors=True)
ok = 0
for t in tests:
    cmd = ['node', '--max-old-space-size=1500', os.path.join(here, 'node-smoke.mjs'), engine, parser,
           '--stub-runtime', '--json-rules', '--only=' + t['name']] + extra
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=90, cwd=os.path.dirname(here))
        lines = [l for l in (r.stdout + r.stderr).splitlines() if l.startswith('[')]
        if lines:
            print(lines[0][:330]); ok += lines[0].startswith('[ok')
        else:
            err = [l for l in (r.stdout + r.stderr).splitlines() if 'FATAL' in l or 'Error' in l or 'heap' in l]
            print(f"[CRASH exit={r.returncode}] {t['name']:34s} {(err[0] if err else '')[:200]}")
    except subprocess.TimeoutExpired:
        print(f"[TIMEOUT      ] {t['name']}")
print(f"\n{ok}/{len(tests)} ok")
