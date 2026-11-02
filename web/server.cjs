'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SettingsStore } = require('../electron/services/settings.cjs');
const { LogStore } = require('../electron/services/logs.cjs');
const { Runner } = require('../electron/services/runner.cjs');
const { detectTools } = require('../electron/services/tools.cjs');
const { DeviceService } = require('../electron/services/devices.cjs');
const { AppService } = require('../electron/services/apps.cjs');
const { ActivateService } = require('../electron/services/activate.cjs');
const { FileVault } = require('../electron/services/files.cjs');
const { ScreenshotService } = require('../electron/services/screenshot.cjs');
const { TaskManager } = require('../electron/services/tasks.cjs');
const { buildFlashSteps } = require('../electron/services/flash.cjs');
const { buildWipeSteps } = require('../electron/services/wipe.cjs');
const { AppMetaService } = require('./appmeta.cjs');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'web-data');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });

const settings = new SettingsStore(DATA).init();
const log = new LogStore(500);
const runner = new Runner({ env: process.env });
let toolchain = detectTools({ configured: settings.get() });
const getTools = () => toolchain;
const refreshTools = () => { toolchain = detectTools({ configured: settings.get() }); return toolchain; };
const devices = new DeviceService({ runner, getTools, log });
const apps = new AppService({ runner, getTools, log });
const activate = new ActivateService({ runner, getTools, log });
const files = new FileVault({ root: DATA });
const screenshot = new ScreenshotService({ runner, getTools, baseDir: DATA, log });
const appmeta = new AppMetaService({ runner, getTools, log, apkPath: path.join(__dirname, 'sakura_appmeta.apk') });
const clients = new Set();
const sse = (event, payload) => {
  const text = 'event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n';
  for (const res of clients) { try { res.write(text); } catch {} }
};
const tasks = new TaskManager({
  runner, log, getTools,
  sendToWindow: (channel, payload) => { if (channel === 'task:event') sse('task', payload); }
});
log.subscribe((entry) => sse('log', entry));

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.json':'application/json; charset=utf-8' };
const ok = (data) => ({ ok: true, data });
const fail = (error, code = 'WEB_API_ERROR') => ({ ok: false, error: { code, message: String(error && error.message || error || '操作失败'), detail: '' } });
const sendJSON = (res, body, status = 200) => { const raw = JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(raw); };
const readJson = (req) => new Promise((resolve, reject) => { let raw = ''; req.on('data', (chunk) => { raw += chunk; if (raw.length > 5 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); } }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON 格式错误')); } }); req.on('error', reject); });
const publicPath = (pathname) => {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.resolve(PUBLIC, '.' + rel);
  if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) return null;
  return full;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;
  try {
    if (pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
      req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
      return;
    }
    if (pathname.startsWith('/api/')) {
      const method = req.method;
      if (pathname === '/api/system/health') {
        const t = refreshTools();
        const [adb, fastboot] = await Promise.all([devices.version('adb'), devices.version('fastboot')]);
        return sendJSON(res, ok({ appVersion: '1.0.0-web', platform: process.platform, arch: process.arch, dataDir: DATA, tools: t, adb, fastboot }));
      }
      if (pathname === '/api/system/appInfo') return sendJSON(res, ok({ name: 'Sakura ADB Toolbox', version: '1.0.0-web', electron: 'Web bridge', chrome: process.versions.chrome || 'browser', node: process.version, dataDir: DATA }));
      if (pathname === '/api/system/openDataDir') return sendJSON(res, ok({ opened: false, dataDir: DATA }));
      if (pathname === '/api/settings' && method === 'GET') return sendJSON(res, ok({ settings: settings.get(), tools: refreshTools(), dataDir: DATA }));
      if (pathname === '/api/settings' && method === 'POST') { const body = await readJson(req); settings.save(body); refreshTools(); return sendJSON(res, ok({ settings: settings.get(), tools: toolchain })); }
      if (pathname === '/api/settings/detect') return sendJSON(res, ok({ tools: refreshTools() }));
      if (pathname === '/api/settings/browseAdb' || pathname === '/api/settings/browseFastboot') return sendJSON(res, fail('浏览器版请直接粘贴可执行文件路径'));
      if (pathname === '/api/devices' && method === 'GET') return sendJSON(res, ok(await devices.list()));
      if (pathname === '/api/device/action') { const b = await readJson(req); return sendJSON(res, ok(await devices.action(b.serial, b.action))); }
      if (pathname === '/api/device/mode' && method === 'GET') { const serial = url.searchParams.get('serial'); return sendJSON(res, ok(await devices.mode(serial))); }
      if (pathname === '/api/device/reboot') { const b = await readJson(req); return sendJSON(res, ok(await devices.rebootMode(b.serial, b.target))); }
      if (pathname === '/api/device/metrics' && method === 'GET') { const serial = url.searchParams.get('serial'); return sendJSON(res, ok(await devices.metrics(serial))); }
      if (pathname === '/api/wireless/connect') { const b = await readJson(req); return sendJSON(res, ok(await devices.connect(b.host, b.port))); }
      if (pathname === '/api/wireless/pair') { const b = await readJson(req); return sendJSON(res, ok(await devices.pair(b.host, b.port, b.code))); }
      if (pathname === '/api/wireless/disconnect') { const b = await readJson(req); return sendJSON(res, ok(await devices.disconnect(b.address))); }
      if (pathname === '/api/activate/apps' && method === 'GET') {
        const serial = url.searchParams.get('serial');
        const data = await activate.list(serial);
        try {
          const meta = await appmeta.get(serial);
          data.apps = data.apps.map((item) => ({ ...item, label: (meta[item.package] && meta[item.package].label) || item.name, icon: (meta[item.package] && meta[item.package].icon) || '' }));
        } catch (error) { log.add({ level: 'warn', source: 'activate', message: error.message }); }
        return sendJSON(res, ok(data));
      }
      if (pathname === '/api/activate/run' && method === 'POST') { const b = await readJson(req); return sendJSON(res, ok(await activate.run(b.serial, b.id))); }
      if (pathname === '/api/activate/open' && method === 'POST') { const b = await readJson(req); return sendJSON(res, ok(await activate.open(b.serial, b.id))); }
      if (pathname === '/api/activate/accounts' && method === 'POST') { const b = await readJson(req); return sendJSON(res, ok(await activate.openAccounts(b.serial))); }
      if (pathname === '/api/apps' && method === 'GET') {
        const serial = url.searchParams.get('serial');
        const data = await apps.list(serial, url.searchParams.get('filter') || 'third');
        try {
          if (url.searchParams.get('refresh') === '1') appmeta.invalidate(serial);
          const meta = await appmeta.get(serial);
          data.packages = data.packages.map((item) => ({ ...item, label: (meta[item.package] && meta[item.package].label) || item.label || '', icon: (meta[item.package] && meta[item.package].icon) || '' }));
        } catch (error) { log.add({ level: 'warn', source: 'appmeta', message: error.message }); }
        return sendJSON(res, ok(data));
      }
      if (pathname === '/api/apps/action') { const b = await readJson(req); const result = await apps.action(b.serial, b.package, b.action); if (b.action === 'uninstall') appmeta.invalidate(b.serial); return sendJSON(res, ok(result)); }
      if (pathname === '/api/apps/export') return sendJSON(res, fail('浏览器版暂不支持直接导出 APK，请使用应用内终端 adb pull'));
      if (pathname === '/api/upload' && method === 'POST') {
        const kind = url.searchParams.get('kind') === 'image' ? 'image' : 'apk';
        const original = String(url.searchParams.get('name') || (kind === 'apk' ? 'upload.apk' : 'upload.img')).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
        const ext = kind === 'apk' ? '.apk' : '.img';
        const dest = path.join(DATA, 'uploads', crypto.randomUUID() + ext);
        const out = fs.createWriteStream(dest);
        let bytes = 0;
        const limit = kind === 'apk' ? 2 * 1024 * 1024 * 1024 : 4 * 1024 * 1024 * 1024;
        req.on('data', (chunk) => { bytes += chunk.length; if (bytes > limit) { req.destroy(); } });
        req.pipe(out);
        out.on('finish', async () => {
          try {
            const record = await files.register(dest, kind);
            record.name = original;
            sendJSON(res, ok(record));
          } catch (error) { try { fs.rmSync(dest, { force: true }); } catch {} sendJSON(res, fail(error)); }
        });
        out.on('error', (error) => sendJSON(res, fail(error)));
        return;
      }
      if (pathname === '/api/install' && method === 'POST') {
        const b = await readJson(req);
        const tools = refreshTools();
        const file = files.consume(b.token, 'apk');
        appmeta.invalidate(b.serial);
        const started = tasks.start({ kind: 'install', serial: b.serial, runId: b.runId, execute: async (ctx) => { await ctx.command({ label: '安装 ' + file.name, tool: tools.adbPath, args: ['-s', b.serial, 'install', '-r', '-d', file.path], timeoutMs: 10 * 60 * 1000 }); return 0; } });
        return sendJSON(res, ok({ runId: started.runId, file: { name: file.name, size: file.size } }));
      }
      if (pathname === '/api/flash' && method === 'POST') {
        const b = await readJson(req);
        if (b.confirm !== 'FLASH') throw new Error('刷写确认短语不正确');
        const tools = refreshTools();
        const file = files.consume(b.token, 'image');
        const built = buildFlashSteps({ serial: b.serial, partition: b.partition, filePath: file.path, fastbootPath: tools.fastbootPath, reboot: Boolean(b.reboot) });
        const started = tasks.start({ kind: 'flash', serial: b.serial, runId: b.runId, destructive: true, execute: async (ctx) => { for (const step of built.steps) await ctx.command(step); return 0; } });
        return sendJSON(res, ok({ runId: started.runId, serial: b.serial, partition: built.partition, file: { name: file.name, size: file.size, sha256: file.sha256 } }));
      }
      if (pathname === '/api/wipe' && method === 'POST') {
        const b = await readJson(req);
        if (b.confirm !== '双清') throw new Error('双清确认短语不正确');
        const tools = refreshTools();
        const built = buildWipeSteps({ serial: b.serial, data: Boolean(b.data), cache: Boolean(b.cache), reboot: Boolean(b.reboot), fastbootPath: tools.fastbootPath });
        const started = tasks.start({ kind: 'wipe', serial: b.serial, runId: b.runId, destructive: true, execute: async (ctx) => { for (const step of built.steps) await ctx.command(step); return 0; } });
        return sendJSON(res, ok({ runId: started.runId, serial: b.serial }));
      }
      if (pathname === '/api/terminal/start') { const b = await readJson(req); return sendJSON(res, ok(tasks.startTerminal({ command: b.command, adbSerial: b.adbSerial, fastbootSerial: b.fastbootSerial, runId: b.runId }))); }
      if (pathname === '/api/terminal/stop') { const b = await readJson(req); return sendJSON(res, ok(tasks.stop(b.runId))); }
      if (pathname === '/api/screenshot') { const b = await readJson(req); return sendJSON(res, ok(await screenshot.capture(b.serial))); }
      if (pathname === '/api/logs' && method === 'GET') return sendJSON(res, ok({ entries: log.list() }));
      if (pathname === '/api/logs/clear') { log.clear(); log.add({ level: 'info', source: 'web', message: '日志已清空' }); return sendJSON(res, ok({ cleared: true })); }
      if (pathname === '/api/logs/export') return sendJSON(res, ok({ cancelled: true }));
      if (pathname === '/api/window/isMaximized') return sendJSON(res, ok({ maximized: false }));
      if (pathname.startsWith('/api/window/')) return sendJSON(res, ok({ ok: true }));
      return sendJSON(res, fail('未知接口', 'NOT_FOUND'), 404);
    }
    const full = publicPath(pathname);
    if (!full) { res.writeHead(403); return res.end('Forbidden'); }
    const data = await fs.promises.readFile(full).catch(() => null);
    if (!data) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (error) {
    if (!res.headersSent) sendJSON(res, fail(error));
    else try { res.end(); } catch {}
  }
});
const net = require('node:net');
const RECORD = path.join(DATA, 'server.json');

function probePort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, '127.0.0.1');
  });
}

async function pickPort(base, tries = 20) {
  if (!Number.isInteger(base) || base <= 0) return 0;
  for (let offset = 0; offset < tries; offset += 1) {
    const candidate = base + offset;
    if (await probePort(candidate)) return candidate;
  }
  return 0;
}

function writeRecord(port) {
  try {
    fs.writeFileSync(RECORD, JSON.stringify({
      pid: process.pid,
      port,
      url: 'http://127.0.0.1:' + port + '/',
      appVersion: '1.0.0-web',
      startedAt: new Date().toISOString()
    }, null, 2));
  } catch (error) { console.error('SERVER_RECORD_FAILED', error.message); }
}

function clearRecord() {
  try {
    const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
    if (record && record.pid === process.pid) fs.rmSync(RECORD, { force: true });
  } catch {}
}

async function startServer() {
  const base = Number(process.env.SAKURA_WEB_PORT || 4400);
  const wanted = Number.isInteger(base) && base > 0 ? await pickPort(base) : 0;
  const listen = (port) => new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(server.address().port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
  let port = 0;
  try {
    port = await listen(wanted);
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') port = await listen(0);
    else throw error;
  }
  writeRecord(port);
  console.log('SAKURA_WEB_URL http://127.0.0.1:' + port);
}

process.on('exit', clearRecord);
process.on('SIGINT', () => { clearRecord(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { clearRecord(); server.close(() => process.exit(0)); });

startServer().catch((error) => { console.error('SERVER_START_FAILED', error); process.exit(1); });
setInterval(() => files.cleanup(), 10 * 60 * 1000).unref();