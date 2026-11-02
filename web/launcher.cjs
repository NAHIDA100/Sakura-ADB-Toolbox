'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'web-data');
const RECORD = path.join(DATA, 'server.json');
const SERVER = path.join(__dirname, 'server.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(prefix) {
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

const DESKTOP = process.argv.includes('--desktop');
const NO_OPEN = process.argv.includes('--no-open');
const REQUESTED_PORT = Number(argValue('--port=') || process.env.SAKURA_WEB_PORT || 4400);

function health(port, timeout = 700) {
  return new Promise((resolve) => {
    if (!port) { resolve(false); return; }
    const req = http.get({ host: '127.0.0.1', port, path: '/api/system/health', timeout }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; if (raw.length > 65536) req.destroy(); });
      res.on('end', () => {
        try {
          const body = JSON.parse(raw);
          resolve(Boolean(body && body.ok && body.data && String(body.data.appVersion || '').includes('web')));
        } catch { resolve(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function readRecord() {
  try {
    const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
    return record && Number(record.port) ? record : null;
  } catch { return null; }
}

function probePort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '127.0.0.1');
  });
}

async function pickPort(base) {
  for (let offset = 0; offset < 20; offset += 1) {
    const candidate = base + offset;
    if (await probePort(candidate)) return candidate;
  }
  return 0;
}

async function findRunning() {
  const record = readRecord();
  const candidates = [];
  if (record && record.port) candidates.push(Number(record.port));
  for (let offset = 0; offset < 6; offset += 1) {
    const candidate = (Number.isInteger(REQUESTED_PORT) && REQUESTED_PORT > 0 ? REQUESTED_PORT : 4400) + offset;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  for (const port of candidates) {
    if (await health(port)) return port;
  }
  return 0;
}

function openTarget(url) {
  if (NO_OPEN) { console.log('SAKURA_WEB_URL ' + url); return; }
  if (DESKTOP) {
    const edgePaths = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ];
    const edge = edgePaths.find((candidate) => fs.existsSync(candidate));
    if (edge) {
      const profile = path.join(process.env.LOCALAPPDATA || DATA, 'Sakura ADB Toolbox', 'EdgeProfile');
      const child = spawn(edge, [
        '--app=' + url,
        '--window-size=1440,900',
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check'
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      console.log('SAKURA_WEB_URL ' + url + ' (Edge app window)');
      return;
    }
  }
  const child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  console.log('SAKURA_WEB_URL ' + url);
}

async function main() {
  const existing = await findRunning();
  if (existing) {
    console.log('SAKURA_WEB_REUSED ' + existing);
    openTarget('http://127.0.0.1:' + existing + '/');
    return;
  }
  const port = await pickPort(Number.isInteger(REQUESTED_PORT) && REQUESTED_PORT > 0 ? REQUESTED_PORT : 4400);
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, SAKURA_WEB_PORT: String(port || 0) }
  });
  child.unref();
  let actual = 0;
  for (let i = 0; i < 60; i += 1) {
    await sleep(400);
    const record = readRecord();
    if (record && record.port && await health(record.port)) { actual = Number(record.port); break; }
    if (port && await health(port)) { actual = port; break; }
  }
  if (!actual) {
    console.error('SAKURA_WEB_START_FAILED: server did not become ready');
    process.exit(1);
  }
  openTarget('http://127.0.0.1:' + actual + '/');
}

main().catch((error) => { console.error('SAKURA_WEB_LAUNCH_FAILED', error); process.exit(1); });
