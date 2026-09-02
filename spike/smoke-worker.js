import { installJsooRuntimeShim } from './jsoo-shims.mjs';
const post = (msg) => self.postMessage(msg);
const log = (msg) => post({ type: 'log', msg });
installJsooRuntimeShim(self, log);
// Emscripten resolves side-car wasm files relative to the worker URL; redirect to the vendored copy.
const WASM_URL = new URL('../docs/vendor/semgrep/semgrep-parser.wasm', import.meta.url).href;
const origFetch = self.fetch.bind(self);
self.fetch = (u, ...rest) => origFetch(String(u).endsWith('semgrep-parser.wasm') ? WASM_URL : u, ...rest);
const target = `using System;
using System.Diagnostics;
namespace Demo {
  public class Svc {
    public static void Run(string input) {
      Console.WriteLine("hello");
      Process.Start(input);
      try { Process.Start("cmd.exe", input); } catch (Exception ex) { throw ex; }
      var t = DateTime.Now;
    }
  }
}
`;
const tests = [
  { name: 'plain', rule: { id: 'r', message: 'm', languages: ['csharp'], severity: 'WARNING', pattern: 'Process.Start(...)' } },
  { name: 'taint', rule: { id: 'r', message: 'm', languages: ['csharp'], severity: 'WARNING', mode: 'taint',
      'pattern-sources': [{ patterns: [{ 'pattern-inside': 'public static void Run(string $P) { ... }' }, { 'focus-metavariable': '$P' }] }],
      'pattern-sinks': [{ pattern: 'Process.Start(...)' }] } },
  { name: 'comparison', rule: { id: 'r', message: 'm', languages: ['csharp'], severity: 'WARNING',
      patterns: [{ pattern: 'Console.WriteLine($X)' }, { 'metavariable-comparison': { metavariable: '$X', comparison: '1 > 0' } }] } },
];
self.onmessage = async () => {
  try {
    const t0 = performance.now();
    const eng = await import('../docs/vendor/semgrep/engine-1.17.1-alpha.2.mjs');
    log(`engine module imported ${Math.round(performance.now() - t0)}ms`);
    const engine = await eng.EngineFactory();
    log(`engine ready ${Math.round(performance.now() - t0)}ms keys=${Object.keys(engine).join(',')}`);
    const cs = await import('../docs/vendor/semgrep/csharp-1.17.1-alpha.0.mjs');
    const parser = await cs.ParserFactory();
    engine.addParser(parser);
    log(`csharp parser ready ${Math.round(performance.now() - t0)}ms lang=${parser.getLang()}`);
    const py = await import('../docs/vendor/semgrep/python-0.0.4.mjs');
    const raw = await py.ParserFactory();
    const lang = raw.getLangs()[0];
    engine.addParser({ setMountPoints: (m) => raw.setMountpoints(m), getLang: () => lang,
      parsePattern: (pe, s) => raw.parsePattern(pe, lang, s), parseTarget: (f) => raw.parseTarget(lang, f) });
    log(`python parser ready ${Math.round(performance.now() - t0)}ms lang=${lang}`);
    const create = self.jsoo_create_file;
    log(`jsoo_create_file: ${typeof create}`);
    let n = 0;
    for (const t of tests) {
      n++;
      const prefix = `/static/run/${n}/`;
      const origLog = console.log; console.log = () => {};
      const started = performance.now();
      let res;
      try {
        create(prefix + 'rules.json', JSON.stringify({ rules: [t.rule] }));
        create(prefix + 'Svc.cs', target);
        const outStr = engine.execute('csharp', prefix + 'rules.json', prefix + 'Svc.cs');
        const parsed = JSON.parse(outStr);
        res = { lines: [...new Set(parsed.matches.map((m) => m.location.start.line))], errors: parsed.errors.map((e) => (e.message || '').slice(0, 80)) };
      } catch (e) { res = { lines: null, errors: ['EXC ' + String(e).slice(0, 200)] }; }
      finally { console.log = origLog; }
      post({ type: 'result', name: t.name, ...res, ms: Math.round(performance.now() - started) });
    }
    post({ type: 'done' });
  } catch (e) { post({ type: 'fatal', msg: String(e && e.stack || e).slice(0, 500) }); }
};
