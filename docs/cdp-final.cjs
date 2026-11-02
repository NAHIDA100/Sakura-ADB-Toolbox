'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const PROFILE = path.join(__dirname, 'chrome-cdp-profile4');
const URL = 'http://127.0.0.1:4400/#/apps';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--remote-allow-origins=*', '--user-data-dir=' + PROFILE, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let version = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(300);
    try { const res = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (res.ok) { version = await res.json(); break; } } catch {}
  }
  if (!version) throw new Error('Chrome DevTools 未就绪');
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有页面目标');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r.result && r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const out = path.join(__dirname, 'screenshots', name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
    console.log('WROTE ' + out + ' ' + fs.statSync(out).size);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    const n = await evaluate("document.querySelectorAll('.app-row').length");
    if (n > 0) break;
  }
  const normal = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.app-row')];
    const imgs = [...document.querySelectorAll('.app-row img')];
    const frozen = document.querySelector('.app-row:has(.app-badge)');
    if (frozen) frozen.scrollIntoView({ block: 'center' });
    return JSON.stringify({ rows: rows.length, imgs: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, badges: document.querySelectorAll('.app-badge').length, frozenRow: frozen ? frozen.innerText.replace(/\\n/g, ' | ') : '' });
  })()`);
  await sleep(1200);
  console.log('NORMAL ' + normal);
  await shot('apps-final.png');
  await send('Runtime.evaluate', { expression: "document.querySelector('[data-filter=\"frozen\"]').click()" });
  for (let i = 0; i < 20; i += 1) {
    await sleep(1000);
    const n = await evaluate("document.querySelectorAll('.app-row').length");
    if (n > 0) break;
  }
  const frozen = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.app-row')];
    return JSON.stringify({ rows: rows.length, badges: document.querySelectorAll('.app-badge').length, enables: document.querySelectorAll('[data-app-action=\"enable\"]').length, subtitle: document.querySelector('[data-apps-subtitle]').innerText, first: rows[0] ? rows[0].innerText.replace(/\\n/g, ' | ') : '' });
  })()`);
  console.log('FROZEN ' + frozen);
  await shot('apps-frozen-final.png');
  ws.close();
  chrome.kill();
}
main().catch((error) => { console.error(error); process.exit(1); });
