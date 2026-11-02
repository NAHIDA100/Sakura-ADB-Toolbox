'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  system: {
    health: () => invoke('system:health'),
    appInfo: () => invoke('system:appInfo'),
    openDataDir: () => invoke('system:openDataDir'),
    showItemInFolder: (filePath) => invoke('system:showItemInFolder', filePath)
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
    detect: () => invoke('settings:detect'),
    browseAdb: () => invoke('settings:browseAdb'),
    browseFastboot: () => invoke('settings:browseFastboot')
  },
  devices: {
    list: () => invoke('devices:list'),
    action: (payload) => invoke('devices:action', payload),
    mode: (serial) => invoke('devices:mode', serial),
    reboot: (payload) => invoke('devices:reboot', payload),
    metrics: (serial) => invoke('devices:metrics', serial),
    connect: (payload) => invoke('wireless:connect', payload),
    pair: (payload) => invoke('wireless:pair', payload),
    disconnect: (payload) => invoke('wireless:disconnect', payload)
  },
  apps: {
    list: (payload) => invoke('apps:list', payload),
    action: (payload) => invoke('apps:action', payload),
    install: (payload) => invoke('apps:install', payload),
    export: (payload) => invoke('apps:export', payload)
  },
  activate: {
    list: (payload) => invoke('activate:list', payload),
    run: (payload) => invoke('activate:run', payload),
    open: (payload) => invoke('activate:open', payload),
    accounts: (payload) => invoke('activate:accounts', payload)
  },
  files: {
    pick: (kind) => invoke('files:pick', kind)
  },
  flash: {
    start: (payload) => invoke('flash:start', payload)
  },
  wipe: {
    start: (payload) => invoke('wipe:start', payload)
  },
  terminal: {
    start: (payload) => invoke('terminal:start', payload),
    stop: (runId) => invoke('terminal:stop', runId)
  },
  screenshot: {
    capture: (serial) => invoke('screenshot:capture', serial)
  },
  logs: {
    list: () => invoke('logs:list'),
    clear: () => invoke('logs:clear'),
    export: () => invoke('logs:export'),
    onAppend: (callback) => subscribe('log:append', callback)
  },
  task: {
    onEvent: (callback) => subscribe('task:event', callback)
  },
  window: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    close: () => invoke('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
    onMaximizedChange: (callback) => subscribe('window:maximized', callback)
  }
};

contextBridge.exposeInMainWorld('sakura', Object.freeze(api));