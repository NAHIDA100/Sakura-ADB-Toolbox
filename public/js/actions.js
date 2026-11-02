import { state, update, setDevices, setMetrics, clearMetrics, selectedAdbDevice } from './store.js';
import { api } from './api.js';
import { toast, toastError } from './components/toast.js';

export function demoGuard() {
  if (!state.demo) return false;
  toast('演示模式不会执行真实设备操作', 'info', '这是界面预览数据');
  return true;
}

export function requireAdbDevice(options = {}) {
  const device = selectedAdbDevice();
  if (!device) {
    toast('请先选择一台在线 ADB 设备', 'warn', '连接设备后可在左侧设备列表切换');
    return null;
  }
  if (device.state === 'unauthorized') {
    toast('设备尚未授权', 'warn', '请解锁手机并在 USB 调试弹窗中点击允许');
    return null;
  }
  if (device.state !== 'device' && device.state !== 'recovery') {
    toast('当前设备状态不可执行该操作', 'warn', '设备状态：' + device.state);
    return null;
  }
  if (options.silent) return device;
  return device;
}

export async function refreshDevices(options = {}) {
  if (state.demo) return state.devices;
  update({ refreshing: true });
  try {
    const snapshot = await api.devices.list();
    state.errorBanner = null;
    setDevices(snapshot);
    return snapshot;
  } catch (error) {
    if (!options.silent) toastError(error, '刷新设备失败');
    update({ errorBanner: error.message || '无法获取设备列表' });
    return null;
  } finally {
    update({ refreshing: false });
  }
}

export async function refreshMetrics(options = {}) {
  if (state.demo) return state.metrics;
  const device = selectedAdbDevice();
  if (!device || device.state !== 'device') {
    if (state.metrics) clearMetrics();
    return null;
  }
  try {
    const metrics = await api.devices.metrics(device.serial);
    setMetrics(metrics);
    return metrics;
  } catch (error) {
    if (!options.silent) toastError(error, '读取设备性能失败');
    update({ metricsError: error.message || '读取性能失败' });
    return null;
  }
}

export async function refreshLogs(options = {}) {
  if (state.demo) return;
  try {
    const data = await api.logs.list();
    update({ logs: data.entries || [] });
  } catch (error) {
    if (!options.silent) toastError(error, '读取日志失败');
  }
}

export function openSettings(navigate) {
  if (typeof navigate === 'function') navigate('/settings');
}
