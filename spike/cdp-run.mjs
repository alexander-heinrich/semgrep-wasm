// Drive headless Chrome over the DevTools protocol: open a URL, poll document.title until DONE/FATAL, print #out.
// Usage: node spike/cdp-run.mjs <url> [timeoutMs]
import { spawn } from 'node:child_process';
const url = process.argv[2];
const timeoutMs = Number(process.argv[3] || 120000);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/claude-cdp-profile', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); } else if (m.method === 'Runtime.consoleAPICalled') { const a = m.params.args.map((x) => x.value ?? x.description).join(' '); if (process.env.CDP_CONSOLE) console.log('console:', a.slice(0, 200)); } };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  const t0 = Date.now();
  let title = '';
  while (Date.now() - t0 < timeoutMs) {
    const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    title = r.result.value;
    if (title === 'DONE' || title === 'FATAL') break;
    await sleep(500);
  }
  const out = await send('Runtime.evaluate', { expression: 'document.getElementById("out") ? document.getElementById("out").textContent : document.body.innerText', returnByValue: true });
  console.log(out.result.value);
  console.log(`\n[cdp] title=${title} elapsed=${Date.now() - t0}ms`);
} catch (e) { console.log('[cdp] error', e); }
finally { proc.kill(); }
