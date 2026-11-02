'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildFlashSteps } = require('./services/flash.cjs');
const { buildWipeSteps } = require('./services/wipe.cjs');

function ok(data) { return { ok: true, data }; }
function fail(error) {
  return {
    ok: false,
    error: {
      code: error && error.code ? String(error.code) : 'APP_ERROR',
      message: error && error.message ? String(error.message) : '操作失败',
      detail: error && error.detail ? String(error.detail).slice(0, 20000) : ''
    }
  };
}

function registerIpc(ctx) {
  const { app, ipcMain, dialog, shell, settings, log, tasks, devices, apps, activate, appmeta, files, screenshot, getTools, refreshTools, getWindow, dataDir } = ctx;

  function senderAllowed(event) {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
    const url = event.senderFrame && event.senderFrame.url ? event.senderFrame.url : win.webContents.getURL();
    return String(url).startsWith('sakura://app/');
  }

  function handle(channel, fn) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        if (!senderAllowed(event)) throw Object.assign(new Error('非法调用来源'), { code: 'FORBIDDEN' });
        return ok(await fn(event, payload));
      } catch (error) {
        return fail(error);
      }
    });
  }

  function windowOrThrow() {
    const win = getWindow();
    if (!win || win.isDestroyed()) throw new Error('主窗口不可用');
    return win;
  }

  async function ensureAdbDevice(serial) {
    const snapshot = await devices.list();
    const device = snapshot.adb.find((item) => item.serial === serial);
    if (!device) throw new Error('当前 ADB 设备列表中找不到该设备，请刷新后重试');
    if (device.state === 'unauthorized') throw Object.assign(new Error('设备未授权，请在手机上允许 USB 调试'), { code: 'UNAUTHORIZED' });
    if (device.state !== 'device' && device.state !== 'recovery') throw Object.assign(new Error('设备当前状态不可执行该操作：' + device.state), { code: 'DEVICE_OFFLINE' });
    return device;
  }

  async function ensureFastbootDevice(serial) {
    const snapshot = await devices.list();
    if (!snapshot.fastboot.some((item) => item.serial === serial)) {
      throw new Error('未在 Fastboot 中检测到该设备，请先进入 Bootloader 并确认驱动正常');
    }
    return true;
  }

  handle('system:health', async () => {
    const tools = refreshTools();
    const [adbVersion, fastbootVersion] = await Promise.all([
      devices.version('adb'),
      devices.version('fastboot')
    ]);
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      dataDir,
      tools,
      adb: adbVersion,
      fastboot: fastbootVersion
    };
  });

  handle('system:appInfo', async () => ({
    name: 'Sakura ADB Toolbox',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dataDir
  }));

  handle('system:openDataDir', async () => {
    const result = await shell.openPath(dataDir);
    if (result) throw new Error('无法打开数据目录：' + result);
    return { opened: true, dataDir };
  });

  handle('system:showItemInFolder', async (filePath) => {
    const target = String(filePath || '');
    if (!target || !fs.existsSync(target)) throw new Error('文件不存在');
    shell.showItemInFolder(target);
    return { shown: true };
  });

  handle('settings:get', async () => ({ settings: settings.get(), tools: refreshTools(), dataDir }));
  handle('settings:detect', async () => ({ tools: refreshTools() }));

  handle('settings:save', async (_event, patch) => {
    const next = { ...settings.get(), ...(patch || {}) };
    const detected = require('./services/tools.cjs').detectTools({ configured: next });
    if (String(next.adbPath || '').trim() && !detected.adbFound) {
      throw new Error('指定的 ADB 路径无效，请选择 adb.exe 或 platform-tools 目录');
    }
    if (String(next.fastbootPath || '').trim() && !detected.fastbootFound) {
      throw new Error('指定的 Fastboot 路径无效，请选择 fastboot.exe 或 platform-tools 目录');
    }
    settings.save({
      adbPath: next.adbPath || '',
      fastbootPath: next.fastbootPath || '',
      reducedMotion: Boolean(next.reducedMotion)
    });
    refreshTools();
    log.add({ level: 'success', source: 'settings', message: '工具路径设置已保存' });
    return { settings: settings.get(), tools: getTools() };
  });

  handle('settings:browseAdb', async () => {
    const win = windowOrThrow();
    const result = await dialog.showOpenDialog(win, {
      title: '选择 adb.exe',
      properties: ['openFile'],
      filters: [{ name: 'ADB', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }]
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  handle('settings:browseFastboot', async () => {
    const win = windowOrThrow();
    const result = await dialog.showOpenDialog(win, {
      title: '选择 fastboot.exe',
      properties: ['openFile'],
      filters: [{ name: 'Fastboot', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }]
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  handle('devices:list', async () => devices.list());

  handle('devices:action', async (_event, payload) => {
    const { serial, action } = payload || {};
    return devices.action(serial, action);
  });

  handle('wireless:connect', async (_event, payload) => devices.connect(payload && payload.host, payload && payload.port));
  handle('wireless:pair', async (_event, payload) => devices.pair(payload && payload.host, payload && payload.port, payload && payload.code));
  handle('wireless:disconnect', async (_event, payload) => devices.disconnect(payload && payload.address));

  handle('devices:mode', async (_event, serial) => devices.mode(serial));
  handle('devices:reboot', async (_event, payload) => devices.rebootMode(payload && payload.serial, payload && payload.target));
  handle('devices:metrics', async (_event, serial) => devices.metrics(serial));

  handle('apps:list', async (_event, payload) => {
    const serial = payload && payload.serial;
    if (payload && payload.refresh) appmeta.invalidate(serial);
    const data = await apps.list(serial, payload && payload.filter);
    try {
      const meta = await appmeta.get(serial);
      data.packages = data.packages.map((item) => ({
        ...item,
        label: (meta[item.package] && meta[item.package].label) || item.label || '',
        icon: (meta[item.package] && meta[item.package].icon) || ''
      }));
    } catch (error) { log.add({ level: 'warn', source: 'appmeta', message: error.message }); }
    return data;
  });
  handle('apps:action', async (_event, payload) => apps.action(payload && payload.serial, payload && payload.package, payload && payload.action));

  handle('files:pick', async (_event, kind) => {
    if (!['apk', 'image'].includes(kind)) throw new Error('不支持的文件选择类型');
    return files.pick(windowOrThrow(), dialog, kind);
  });

  handle('activate:list', async (_event, payload) => {
    const serial = payload && payload.serial;
    const data = await activate.list(serial);
    try {
      const meta = await appmeta.get(serial);
      data.apps = data.apps.map((item) => ({
        ...item,
        label: (meta[item.package] && meta[item.package].label) || item.name,
        icon: (meta[item.package] && meta[item.package].icon) || ''
      }));
    } catch (error) { log.add({ level: 'warn', source: 'appmeta', message: error.message }); }
    return data;
  });
  handle('activate:run', async (_event, payload) => activate.run(payload && payload.serial, payload && payload.id));
  handle('activate:open', async (_event, payload) => activate.open(payload && payload.serial, payload && payload.id));
  handle('activate:accounts', async (_event, payload) => activate.openAccounts(payload && payload.serial));
  handle('apps:install', async (_event, payload) => {
    const serial = payload && payload.serial;
    await ensureAdbDevice(serial);
    const tools = getTools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const record = files.consume(payload && payload.token, 'apk');
    const runId = payload && payload.runId;
    log.add({ level: 'info', source: 'apps', message: '开始安装 ' + record.name });
    const result = tasks.start({
      kind: 'install',
      serial,
      runId,
      execute: async (task) => {
        await task.command({
          label: '安装 ' + record.name,
          tool: tools.adbPath,
          args: ['-s', serial, 'install', '-r', '-d', record.path],
          timeoutMs: 10 * 60 * 1000
        });
        return 0;
      }
    });
    return { runId: result.runId, file: { name: record.name, size: record.size } };
  });

  handle('apps:export', async (_event, payload) => {
    const serial = payload && payload.serial;
    const pkg = payload && payload.package;
    await ensureAdbDevice(serial);
    const apk = await apps.apkPath(serial, pkg);
    const win = windowOrThrow();
    const save = await dialog.showSaveDialog(win, {
      title: '导出 base APK',
      defaultPath: path.join(app.getPath('downloads'), apk.package + '.apk'),
      filters: [{ name: 'Android 应用', extensions: ['apk'] }]
    });
    if (save.canceled || !save.filePath) return { cancelled: true };
    const tools = getTools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const result = tasks.start({
      kind: 'export',
      serial,
      execute: async (task) => {
        await task.command({
          label: '导出 ' + apk.package,
          tool: tools.adbPath,
          args: ['-s', serial, 'pull', apk.remotePath, save.filePath],
          timeoutMs: 5 * 60 * 1000
        });
        return 0;
      }
    });
    log.add({ level: 'info', source: 'apps', message: '正在导出 ' + apk.package + ' → ' + save.filePath });
    return { runId: result.runId, savePath: save.filePath, package: apk.package };
  });

  handle('flash:start', async (_event, payload) => {
    const { serial, partition, token, confirm, reboot, runId } = payload || {};
    if (confirm !== 'FLASH') throw new Error('刷写确认短语不正确');
    if (tasks.hasDestructive()) throw Object.assign(new Error('已有刷写或双清任务正在进行'), { code: 'BUSY' });
    await ensureFastbootDevice(serial);
    const tools = getTools();
    if (!tools.fastbootPath) throw new Error('未找到 fastboot');
    const record = files.consume(token, 'image');
    const built = buildFlashSteps({ serial, partition, filePath: record.path, fastbootPath: tools.fastbootPath, reboot: Boolean(reboot) });
    log.add({ level: 'warn', source: 'flash', message: '开始刷写 ' + built.partition + ' · ' + record.name });
    const started = tasks.start({
      kind: 'flash',
      serial,
      runId,
      destructive: true,
      execute: async (task) => {
        for (const step of built.steps) await task.command(step);
        return 0;
      }
    });
    return {
      runId: started.runId,
      serial,
      partition: built.partition,
      file: { name: record.name, size: record.size, sha256: record.sha256 }
    };
  });

  handle('wipe:start', async (_event, payload) => {
    const { serial, data, cache, reboot, confirm, runId } = payload || {};
    if (confirm !== '双清') throw new Error('双清确认短语不正确');
    if (tasks.hasDestructive()) throw Object.assign(new Error('已有刷写或双清任务正在进行'), { code: 'BUSY' });
    await ensureFastbootDevice(serial);
    const tools = getTools();
    if (!tools.fastbootPath) throw new Error('未找到 fastboot');
    const built = buildWipeSteps({ serial, data: Boolean(data), cache: Boolean(cache), reboot: Boolean(reboot), fastbootPath: tools.fastbootPath });
    log.add({ level: 'warn', source: 'wipe', message: '开始双清 · ' + serial });
    const started = tasks.start({
      kind: 'wipe',
      serial,
      runId,
      destructive: true,
      execute: async (task) => {
        for (const step of built.steps) await task.command(step);
        return 0;
      }
    });
    return { runId: started.runId, serial };
  });

  handle('terminal:start', async (_event, payload) => {
    const result = tasks.startTerminal({
      command: payload && payload.command,
      adbSerial: payload && payload.adbSerial,
      fastbootSerial: payload && payload.fastbootSerial,
      runId: payload && payload.runId
    });
    return result;
  });
  handle('terminal:stop', async (_event, runId) => tasks.stop(runId));

  handle('screenshot:capture', async (_event, serial) => {
    await ensureAdbDevice(serial);
    return screenshot.capture(serial);
  });

  handle('logs:list', async () => ({ entries: log.list() }));
  handle('logs:clear', async () => {
    log.clear();
    log.add({ level: 'info', source: 'system', message: '日志已清空' });
    return { cleared: true };
  });
  handle('logs:export', async () => {
    const win = windowOrThrow();
    const d = new Date();
    const name = 'Sakura-ADB-Logs-' + d.toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
    const save = await dialog.showSaveDialog(win, {
      title: '导出日志',
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    });
    if (save.canceled || !save.filePath) return { cancelled: true };
    fs.writeFileSync(save.filePath, log.toText(), 'utf8');
    shell.showItemInFolder(save.filePath);
    return { saved: true, path: save.filePath };
  });

  handle('window:minimize', async () => { windowOrThrow().minimize(); return { ok: true }; });
  handle('window:toggleMaximize', async () => {
    const win = windowOrThrow();
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return { maximized: win.isMaximized() };
  });
  handle('window:isMaximized', async () => ({ maximized: windowOrThrow().isMaximized() }));
  handle('window:close', async () => { windowOrThrow().close(); return { ok: true }; });
}

module.exports = { registerIpc };