const listeners = new Set();
const safeStorage = {
  get(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage can be unavailable */ }
  }
};

export const state = {
  demo: false,
  qa: false,
  booted: false,
  health: null,
  settings: {},
  tools: null,
  devices: { adb: [], fastboot: [], errors: [], checkedAt: null },
  activeAdbSerial: safeStorage.get('sakura.activeAdb'),
  activeFastbootSerial: safeStorage.get('sakura.activeFastboot'),
  metrics: null,
  metricsError: '',
  history: { cpu: [], mem: [], temp: [], storage: [] },
  logs: [],
  apps: null,
  appsLoading: false,
  appsError: '',
  refreshing: false,
  lastRefresh: null,
  route: '/dashboard',
  errorBanner: null
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  for (const listener of listeners) {
    try { listener(state); } catch (error) { console.error(error); }
  }
}

export function update(patch) {
  if (patch && typeof patch === 'object') Object.assign(state, patch);
  notify();
  return state;
}

export function selectedAdbDevice() {
  return state.devices.adb.find((device) => device.serial === state.activeAdbSerial) || null;
}

export function selectedFastbootDevice() {
  return state.devices.fastboot.find((device) => device.serial === state.activeFastbootSerial) || null;
}

export function setActiveAdb(serial, silent = false) {
  state.activeAdbSerial = serial || '';
  safeStorage.set('sakura.activeAdb', state.activeAdbSerial);
  if (!silent) notify();
}

export function setActiveFastboot(serial, silent = false) {
  state.activeFastbootSerial = serial || '';
  safeStorage.set('sakura.activeFastboot', state.activeFastbootSerial);
  if (!silent) notify();
}

export function reconcileSelections(devices) {
  const adb = Array.isArray(devices && devices.adb) ? devices.adb : [];
  const fastboot = Array.isArray(devices && devices.fastboot) ? devices.fastboot : [];
  const adbCurrent = adb.find((device) => device.serial === state.activeAdbSerial);
  const adbPreferred = adb.find((device) => device.state === 'device') || adb[0] || null;
  const nextAdb = adbCurrent || adbPreferred;
  const fastbootCurrent = fastboot.find((device) => device.serial === state.activeFastbootSerial);
  const nextFastboot = fastbootCurrent || fastboot[0] || null;

  if ((nextAdb && nextAdb.serial) !== state.activeAdbSerial) {
    state.activeAdbSerial = nextAdb ? nextAdb.serial : '';
    safeStorage.set('sakura.activeAdb', state.activeAdbSerial);
  }
  if ((nextFastboot && nextFastboot.serial) !== state.activeFastbootSerial) {
    state.activeFastbootSerial = nextFastboot ? nextFastboot.serial : '';
    safeStorage.set('sakura.activeFastboot', state.activeFastbootSerial);
  }
}

export function setDevices(devices) {
  state.devices = {
    adb: Array.isArray(devices && devices.adb) ? devices.adb : [],
    fastboot: Array.isArray(devices && devices.fastboot) ? devices.fastboot : [],
    errors: Array.isArray(devices && devices.errors) ? devices.errors : [],
    checkedAt: (devices && devices.checkedAt) || new Date().toISOString()
  };
  reconcileSelections(state.devices);
  state.lastRefresh = state.devices.checkedAt;
  notify();
}

export function setMetrics(metrics) {
  state.metrics = metrics || null;
  if (metrics) {
    const merge = (key, value, cap = 12) => {
      if (!Number.isFinite(Number(value))) return;
      const list = state.history[key] || [];
      list.push(Number(value));
      if (list.length > cap) list.splice(0, list.length - cap);
      state.history[key] = list;
    };
    merge('cpu', metrics.cpuPercent);
    const memPercent = metrics.memTotalKb && metrics.memUsedKb != null
      ? (metrics.memUsedKb / metrics.memTotalKb) * 100
      : null;
    merge('mem', memPercent);
    merge('temp', metrics.temperatureC);
    const storagePercent = metrics.storageTotalKb && metrics.storageUsedKb != null
      ? (metrics.storageUsedKb / metrics.storageTotalKb) * 100
      : null;
    merge('storage', storagePercent);
  }
  notify();
}

export function clearMetrics() {
  state.metrics = null;
  state.metricsError = '';
  notify();
}

export function setLogs(entries) {
  state.logs = Array.isArray(entries) ? entries.slice(-500) : [];
  notify();
}

export function addLog(entry) {
  if (!entry) return;
  if (state.logs.some((item) => item.id === entry.id)) return;
  state.logs.push(entry);
  if (state.logs.length > 500) state.logs.splice(0, state.logs.length - 500);
  notify();
}

export function setApps(data) {
  state.apps = data || null;
  notify();
}

export function resetMetricHistory() {
  state.history = { cpu: [], mem: [], temp: [], storage: [] };
}
