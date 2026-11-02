const bridge = window.sakura;

export class SakuraError extends Error {
  constructor(message, code = 'APP_ERROR', detail = '') {
    super(message);
    this.name = 'SakuraError';
    this.code = code;
    this.detail = detail;
  }
}

function unwrap(response) {
  if (!response || response.ok !== true) {
    const error = (response && response.error) || {};
    throw new SakuraError(error.message || '操作失败', error.code || 'APP_ERROR', error.detail || '');
  }
  return response.data;
}

function call(invoker) {
  if (!bridge) return Promise.reject(new SakuraError('主进程连接不可用', 'NO_BRIDGE'));
  return Promise.resolve().then(invoker).then(unwrap);
}

function activateBridge() {
  if (!bridge || !bridge.activate) throw new SakuraError('当前运行模式不支持免Root激活，请使用网页版', 'NO_ACTIVATE');
  return bridge.activate;
}

export function hasBridge() {
  return Boolean(bridge);
}

const taskListeners = new Map();
let taskBound = false;

function bindTaskEvents() {
  if (!bridge || taskBound) return;
  taskBound = true;
  bridge.task.onEvent((event) => {
    const handler = taskListeners.get(event && event.runId);
    if (handler) handler(event);
  });
}

export function startStreamingTask(invoker, payload = {}, handlers = {}) {
  bindTaskEvents();
  const runId = crypto.randomUUID();
  let startData = null;
  let taskError = null;
  let finished = false;
  const cleanup = () => taskListeners.delete(runId);

  const promise = new Promise((resolve, reject) => {
    const onEvent = (event) => {
      if (!event) return;
      if (event.type === 'start') return;
      if (event.type === 'stage') {
        try { handlers.onStage && handlers.onStage(event.label, event); } catch (error) { console.error(error); }
        return;
      }
      if (event.type === 'output') {
        const lines = Array.isArray(event.lines) ? event.lines : [];
        for (const item of lines) {
          try { handlers.onLine && handlers.onLine(item.line, item.stream); } catch (error) { console.error(error); }
        }
        return;
      }
      if (event.type === 'error') {
        taskError = event;
        try { handlers.onError && handlers.onError(event); } catch (error) { console.error(error); }
        return;
      }
      if (event.type === 'done') {
        if (finished) return;
        finished = true;
        cleanup();
        const result = { runId, code: event.code, durationMs: event.durationMs, data: startData };
        try { handlers.onDone && handlers.onDone(result, taskError); } catch (error) { console.error(error); }
        if (event.code === 0 && !taskError) {
          resolve(result);
        } else {
          reject(new SakuraError(
            (taskError && taskError.message) || '操作失败',
            (taskError && taskError.code) || 'TASK_FAILED',
            (taskError && taskError.detail) || ''
          ));
        }
      }
    };

    taskListeners.set(runId, onEvent);
    let request;
    try {
      request = invoker({ ...payload, runId });
    } catch (error) {
      finished = true;
      cleanup();
      reject(error);
      return;
    }
    Promise.resolve(request).then((response) => {
      if (response && response.ok !== true) {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new SakuraError(response.error?.message || '操作失败', response.error?.code || 'APP_ERROR', response.error?.detail || ''));
        return;
      }
      startData = response && response.data ? response.data : null;
      if (startData && startData.cancelled) {
        if (finished) return;
        finished = true;
        cleanup();
        const cancelledResult = { runId, code: 0, cancelled: true, data: startData };
        try { handlers.onCancelled && handlers.onCancelled(startData); } catch (error) { console.error(error); }
        resolve(cancelledResult);
        return;
      }
      try { handlers.onStarted && handlers.onStarted(startData); } catch (error) { console.error(error); }
    }).catch((error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    });
  });

  return { runId, promise };
}

export const api = {
  system: {
    health: () => call(() => bridge.system.health()),
    appInfo: () => call(() => bridge.system.appInfo()),
    openDataDir: () => call(() => bridge.system.openDataDir()),
    showItemInFolder: (filePath) => call(() => bridge.system.showItemInFolder(filePath))
  },
  settings: {
    get: () => call(() => bridge.settings.get()),
    save: (patch) => call(() => bridge.settings.save(patch)),
    detect: () => call(() => bridge.settings.detect()),
    browseAdb: () => call(() => bridge.settings.browseAdb()),
    browseFastboot: () => call(() => bridge.settings.browseFastboot())
  },
  devices: {
    list: () => call(() => bridge.devices.list()),
    action: (serial, action) => call(() => bridge.devices.action({ serial, action })),
    mode: (serial) => call(() => bridge.devices.mode(serial)),
    reboot: (serial, target) => call(() => bridge.devices.reboot({ serial, target })),
    metrics: (serial) => call(() => bridge.devices.metrics(serial)),
    connect: (host, port) => call(() => bridge.devices.connect({ host, port })),
    pair: (host, port, code) => call(() => bridge.devices.pair({ host, port, code })),
    disconnect: (address) => call(() => bridge.devices.disconnect({ address }))
  },
  apps: {
    list: (serial, filter, refresh) => call(() => bridge.apps.list({ serial, filter, refresh })),
    action: (serial, packageName, action) => call(() => bridge.apps.action({ serial, package: packageName, action }))
  },
  activate: {
    list: (serial) => call(() => activateBridge().list({ serial })),
    run: (serial, id) => call(() => activateBridge().run({ serial, id })),
    open: (serial, id) => call(() => activateBridge().open({ serial, id })),
    accounts: (serial) => call(() => activateBridge().accounts({ serial }))
  },
  files: {
    pick: (kind) => call(() => bridge.files.pick(kind))
  },
  logs: {
    list: () => call(() => bridge.logs.list()),
    clear: () => call(() => bridge.logs.clear()),
    export: () => call(() => bridge.logs.export())
  },
  screenshot: {
    capture: (serial) => call(() => bridge.screenshot.capture(serial))
  },
  window: {
    minimize: () => call(() => bridge.window.minimize()),
    toggleMaximize: () => call(() => bridge.window.toggleMaximize()),
    close: () => call(() => bridge.window.close()),
    isMaximized: () => call(() => bridge.window.isMaximized()),
    onMaximizedChange: (callback) => bridge ? bridge.window.onMaximizedChange(callback) : () => {}
  }
};

export function installApk(serial, token, handlers = {}) {
  return startStreamingTask((payload) => bridge.apps.install(payload), { serial, token }, handlers);
}

export function exportApp(serial, packageName, handlers = {}) {
  return startStreamingTask((payload) => bridge.apps.export(payload), { serial, package: packageName }, handlers);
}

export function startFlash(payload, handlers = {}) {
  return startStreamingTask((request) => bridge.flash.start(request), payload, handlers);
}

export function startWipe(payload, handlers = {}) {
  return startStreamingTask((request) => bridge.wipe.start(request), payload, handlers);
}

export function startTerminal(payload, handlers = {}) {
  return startStreamingTask((request) => bridge.terminal.start(request), payload, handlers);
}

export function stopTerminal(runId) {
  return call(() => bridge.terminal.stop(runId));
}

export function onLog(callback) {
  if (!bridge) return () => {};
  return bridge.logs.onAppend(callback);
}