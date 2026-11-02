'use strict';
const { app, BrowserWindow, Menu, dialog, session, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { registerScheme, installProtocol } = require('./protocol.cjs');
const { SettingsStore } = require('./services/settings.cjs');
const { LogStore } = require('./services/logs.cjs');
const { Runner } = require('./services/runner.cjs');
const { detectTools } = require('./services/tools.cjs');
const { DeviceService } = require('./services/devices.cjs');
const { AppService } = require('./services/apps.cjs');
const { ActivateService } = require('./services/activate.cjs');
const { AppMetaService } = require('../web/appmeta.cjs');
const { FileVault } = require('./services/files.cjs');
const { ScreenshotService } = require('./services/screenshot.cjs');
const { TaskManager } = require('./services/tasks.cjs');
const { registerIpc } = require('./ipc.cjs');

// Compatibility mode for remote/virtualized Windows sessions whose GPU process
// or Chromium sandbox cannot initialize. Without these switches the process can
// exit before a BrowserWindow is ever shown. The renderer remains isolated via
// contextIsolation, CSP and a preload-only IPC bridge.
// Default to Chromium's GPU path. The old unconditional --disable-gpu was a
// workaround for the low-integrity workspace and makes every glass animation
// run in software (5-10 FPS). Keep an explicit fallback for remote desktops
// or machines whose GPU process cannot start: launch with --software.
const softwareRendering = process.argv.includes('--software') || process.env.SAKURA_SOFTWARE === '1';
if (softwareRendering) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}
app.commandLine.appendSwitch('no-sandbox');

app.setName('Sakura ADB Toolbox');
app.setAppUserModelId('com.sakura.adbtoolbox');

// Keep Chromium's profile, singleton lock and GPU cache out of Roaming AppData.
// Some Windows profiles/security tools deny lock-file creation there, which
// makes requestSingleInstanceLock() fail and the app quit before any window.
try {
  const portableRoot = path.dirname(process.execPath);
  const portable = fs.existsSync(path.join(portableRoot, 'portable.flag'));
  const userDataDir = portable
    ? path.join(portableRoot, 'data')
    : path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Sakura ADB Toolbox');
  fs.mkdirSync(userDataDir, { recursive: true });
  app.setPath('userData', userDataDir);
} catch (error) {
  console.error('USER_DATA_SETUP_FAILED', error);
}

registerScheme();

function argValue(prefix) {
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

const isDev = process.argv.includes('--dev');
const isDemo = process.argv.includes('--demo');
const screenshotArg = argValue('--screenshot=');
const screenshotPath = screenshotArg ? path.resolve(screenshotArg) : '';
const routeArg = argValue('--route=') || '/dashboard';
const sizeArg = argValue('--window-size=');
const clickSelector = argValue('--click=');
const hoverArg = argValue('--hover=');
const hoverPoint = (() => {
  const match = String(hoverArg || '').match(/^(\d+),(\d+)$/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
})();
const qaMode = Boolean(screenshotPath);

let mainWindow = null;
let settings = null;
let log = null;
let runner = null;
let toolchain = null;
let tasks = null;
let files = null;
let cleaningTimer = null;
let saveTimer = null;
let busyDialogOpen = false;
let didCapture = false;

function normalizeRoute(route) {
  let value = String(route || '/dashboard').trim();
  if (value.startsWith('#')) value = value.slice(1);
  if (!value.startsWith('/')) value = '/' + value;
  return value || '/dashboard';
}

function parseSize(value) {
  const match = String(value || '').match(/^(\d{3,4})x(\d{3,4})$/i);
  if (!match) return null;
  return { width: Math.max(900, Number(match[1])), height: Math.max(560, Number(match[2])) };
}

function boundsAreVisible(bounds) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width - 80 &&
      bounds.x + bounds.width > area.x + 80 &&
      bounds.y < area.y + area.height - 60 &&
      bounds.y + bounds.height > area.y + 60
    );
  });
}

function createWindow() {
  const saved = settings.getWindowBounds();
  const primary = screen.getPrimaryDisplay().workArea;
  let width = saved.width || 1440;
  let height = saved.height || 900;
  let x = saved.x;
  let y = saved.y;
  const qaSize = parseSize(sizeArg);
  if (qaMode && qaSize) {
    width = qaSize.width;
    height = qaSize.height;
    x = undefined;
    y = undefined;
  } else {
    width = Math.min(width, primary.width);
    height = Math.min(height, primary.height);
    if (!boundsAreVisible({ width, height, x, y })) {
      x = undefined;
      y = undefined;
    }
  }

  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: qaMode ? 800 : 1080,
    minHeight: qaMode ? 500 : 640,
    frame: false,
    show: true,
    backgroundColor: '#fbf8ff',
    title: 'Sakura ADB Toolbox',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: isDev
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!String(url).startsWith('sakura://app/')) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (isDev) return;
    const key = String(input.key || '').toLowerCase();
    if (key === 'f5' || (input.control && key === 'r')) event.preventDefault();
    if (input.control && input.shift && key === 'i') event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.add({ level: 'error', source: 'system', message: '渲染进程异常退出：' + details.reason });
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('DID_FAIL_LOAD', errorCode, errorDescription, validatedURL);
    log.add({ level: 'error', source: 'system', message: '界面加载失败：' + errorDescription + ' (' + errorCode + ')' });
  });
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('DID_FINISH_LOAD', mainWindow.webContents.getURL(), mainWindow.webContents.getTitle());
  });
  mainWindow.webContents.on('console-message', (...args) => {
    if (!qaMode) return;
    const detail = args.slice(1).map((value) => {
      if (value && typeof value === 'object') {
        return JSON.stringify({ level: value.level, message: value.message, sourceId: value.sourceId, lineNumber: value.lineNumber });
      }
      return String(value);
    }).join(' ');
    console.error('RENDERER_CONSOLE ' + detail);
  });

  mainWindow.on('maximize', () => sendWindowState());
  mainWindow.on('unmaximize', () => sendWindowState());
  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);

  mainWindow.on('close', (event) => {
    if (tasks && tasks.hasDestructive()) {
      event.preventDefault();
      if (!busyDialogOpen) {
        busyDialogOpen = true;
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '操作进行中',
          message: '正在刷写或双清，暂时不能关闭工具箱。',
          detail: '中断刷写可能造成设备无法启动。请等待操作完成；你可以先最小化窗口。',
          buttons: ['最小化并继续等待', '取消关闭'],
          defaultId: 0,
          cancelId: 1,
          noLink: true
        }).then((result) => {
          busyDialogOpen = false;
          if (result.response === 0 && mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
        }).catch(() => { busyDialogOpen = false; });
      }
      return;
    }
    saveBoundsNow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const query = new URLSearchParams();
  if (isDemo) query.set('demo', '1');
  if (qaMode) query.set('qa', '1');
  const suffix = query.toString() ? '?' + query.toString() : '';
  const url = 'sakura://app/index.html' + suffix + '#' + normalizeRoute(routeArg);

  mainWindow.once('ready-to-show', () => {
    if (!qaMode || clickSelector || hoverPoint) {
      if (settings.getWindowBounds().maximized && !qaMode) mainWindow.maximize();
      if (qaMode) mainWindow.showInactive();
      else mainWindow.show();
      if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    sendWindowState();
    if (!qaMode || didCapture) return;
    didCapture = true;
    if (clickSelector) {
      setTimeout(() => {
        const script = '(() => { const el = document.querySelector(' + JSON.stringify(clickSelector) + '); if (el) el.click(); return Boolean(el); })()';
        mainWindow.webContents.executeJavaScript(script).catch((error) => console.error('QA_CLICK_FAILED', error));
      }, 2200);
    }
    if (hoverPoint) {
      setTimeout(() => {
        mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: hoverPoint.x, y: hoverPoint.y });
        mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: hoverPoint.x + 2, y: hoverPoint.y + 1 });
      }, 2200);
    }
    setTimeout(async () => {
      try {
        const image = await mainWindow.webContents.capturePage();
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        fs.writeFileSync(screenshotPath, image.toPNG());
        console.log('SCREENSHOT_SAVED ' + screenshotPath);
        const wait = setTimeout(() => app.exit(0), 200);
        wait.unref();
      } catch (error) {
        console.error('SCREENSHOT_FAILED', error);
        app.exit(1);
      }
    }, isDemo ? 3800 : 6500);
  });

  mainWindow.loadURL(url).catch((error) => {
    console.error('LOAD_FAILED', error);
    log.add({ level: 'error', source: 'system', message: '无法加载界面：' + error.message });
  });
}

function scheduleSaveBounds() {
  if (qaMode) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBoundsNow, 400);
}

function saveBoundsNow() {
  if (!mainWindow || mainWindow.isDestroyed() || !settings) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    settings.saveWindowBounds({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: mainWindow.isMaximized()
    });
  } catch (error) {
    console.error('SAVE_BOUNDS_FAILED', error && error.message);
  }
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:maximized', { maximized: mainWindow.isMaximized() });
}

function wireServices() {
  const dataDir = app.getPath('userData');
  settings = new SettingsStore(dataDir).init();
  log = new LogStore(500);
  runner = new Runner({ env: process.env });
  toolchain = detectTools({ configured: settings.get() });

  function getTools() { return toolchain; }
  function refreshTools() {
    toolchain = detectTools({ configured: settings.get() });
    return toolchain;
  }

  const devices = new DeviceService({ runner, getTools, log });
  const apps = new AppService({ runner, getTools, log });
  const activate = new ActivateService({ runner, getTools, log });
  const appmeta = new AppMetaService({ runner, getTools, log, apkPath: path.join(__dirname, '..', 'web', 'sakura_appmeta.apk') });
  files = new FileVault({ root: dataDir });
  const screenshot = new ScreenshotService({ runner, getTools, baseDir: dataDir, log });
  tasks = new TaskManager({
    runner,
    log,
    getTools,
    sendToWindow: (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    }
  });

  installProtocol(path.join(__dirname, '..', 'public'));
  registerIpc({
    app, ipcMain: require('electron').ipcMain, dialog, shell,
    settings, log, tasks, devices, apps, activate, appmeta, files, screenshot,
    getTools, refreshTools, getWindow: () => mainWindow, dataDir
  });

  log.subscribe((entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('log:append', entry);
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  Menu.setApplicationMenu(null);

  if (cleaningTimer) clearInterval(cleaningTimer);
  cleaningTimer = setInterval(() => files.cleanup(), 10 * 60 * 1000);
  cleaningTimer.unref();

  log.add({ level: 'success', source: 'system', message: 'Sakura ADB Toolbox 已启动' });
  log.add({
    level: toolchain.adbFound ? 'success' : 'warn',
    source: 'system',
    message: toolchain.adbFound
      ? '已检测到 ADB：' + toolchain.adbPath
      : '未检测到 ADB，请前往设置指定 platform-tools 路径'
  });
  if (toolchain.fastbootFound) {
    log.add({ level: 'info', source: 'system', message: '已检测到 Fastboot：' + toolchain.fastbootPath });
  }
}

// The Chromium process-singleton lock can fail on locked-down Windows
// profiles (Access denied). Never let that prevent the UI from opening; a
// second instance is harmless, a missing window is not.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.warn('SINGLE_INSTANCE_LOCK_FAILED: continuing without the lock');
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

app.whenReady().then(async () => {
  wireServices();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error('BOOT_FAILED', error);
  dialog.showErrorBox('Sakura ADB Toolbox 启动失败', String(error && error.stack ? error.stack : error));
  app.exit(1);
});

app.on('before-quit', () => {
  saveBoundsNow();
  if (tasks) tasks.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});