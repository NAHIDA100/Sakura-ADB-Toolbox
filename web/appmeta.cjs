'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PKG = 'sakura.meta';
const ACTIVITY = PKG + '/.DumpActivity';
const REMOTE_DIR = '/sdcard/Android/data/' + PKG + '/files';
const REMOTE_FILE = REMOTE_DIR + '/icons.txt';
const CACHE_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class AppMetaService {
  constructor(options) {
    this.runner = options.runner;
    this.getTools = options.getTools;
    this.log = options.log;
    this.apkPath = options.apkPath;
    this.cache = new Map();
    this.installed = new Map();
    this.inflight = new Map();
  }

  invalidate(serial) {
    this.cache.delete(serial);
  }

  adb(serial, args, timeoutMs = 30000) {
    return this.runner.run(this.getTools().adbPath, ['-s', serial, ...args], { timeoutMs, maxBytes: 16 * 1024 * 1024 });
  }

  async ensureHelper(serial) {
    if (this.installed.get(serial)) return;
    const listed = await this.adb(serial, ['shell', 'pm', 'list', 'packages', PKG], 15000);
    if (new RegExp('package:' + PKG.replace(/\./g, '\\.')).test(String(listed.stdout || ''))) {
      this.installed.set(serial, true);
      return;
    }
    if (!fs.existsSync(this.apkPath)) throw new Error('缺少图标读取组件');
    const install = await this.adb(serial, ['install', '-r', this.apkPath], 120000);
    const text = String(install.stdout || '') + String(install.stderr || '');
    if (install.code !== 0 || !/Success/i.test(text)) throw new Error('图标读取组件安装失败：' + text.trim());
    this.installed.set(serial, true);
    this.log.add({ level: 'success', source: 'appmeta', message: '已安装图标读取组件 · ' + serial });
  }

  async get(serial) {
    const cached = this.cache.get(serial);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.map;
    if (this.inflight.has(serial)) return this.inflight.get(serial);
    const task = this.load(serial).then((map) => {
      this.cache.set(serial, { at: Date.now(), map });
      return map;
    }).finally(() => this.inflight.delete(serial));
    this.inflight.set(serial, task);
    return task;
  }

  async load(serial) {
    const tools = this.getTools();
    if (!tools.adbPath || !fs.existsSync(this.apkPath)) return {};
    await this.ensureHelper(serial);
    await this.adb(serial, ['shell', 'rm', '-f', REMOTE_FILE], 10000).catch(() => {});
    const start = await this.adb(serial, ['shell', 'am', 'start', '-n', ACTIVITY], 30000);
    const startText = String(start.stdout || '') + String(start.stderr || '');
    if (start.code !== 0 || /^Error/im.test(startText.trim())) throw new Error('无法启动图标读取组件：' + startText.trim());
    let ready = false;
    for (let i = 0; i < 50; i += 1) {
      await sleep(500);
      const stat = await this.adb(serial, ['shell', 'wc', '-c', REMOTE_FILE], 10000).catch(() => null);
      const size = stat && Number((String(stat.stdout || '').match(/(\d+)/) || [])[1]);
      if (!size) continue;
      const tail = await this.adb(serial, ['shell', 'tail', '-n', '1', REMOTE_FILE], 10000).catch(() => null);
      if (tail && /^END\t/.test(String(tail.stdout || '').trim())) { ready = true; break; }
    }
    if (!ready) throw new Error('读取设备应用图标超时');
    const local = path.join(os.tmpdir(), 'sakura-appmeta-' + serial + '-' + Date.now() + '.txt');
    const pull = await this.adb(serial, ['pull', REMOTE_FILE, local], 60000);
    if (pull.code !== 0 || !fs.existsSync(local)) throw new Error('拉取应用图标失败');
    const raw = fs.readFileSync(local, 'utf8');
    fs.rmSync(local, { force: true });
    const map = {};
    for (const line of raw.split(/\r?\n/)) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const pkg = parts[0].trim();
      if (!pkg || pkg === 'END' || pkg === 'FATAL') continue;
      const label = parts[1].trim();
      const b64 = parts[2].trim();
      map[pkg] = { label, icon: b64 ? 'data:image/png;base64,' + b64 : '' };
    }
    if (!Object.keys(map).length) throw new Error('设备没有返回应用图标');
    this.log.add({ level: 'success', source: 'appmeta', message: '已读取 ' + Object.keys(map).length + ' 个应用的真实名称与图标' });
    return map;
  }
}

module.exports = { AppMetaService };
