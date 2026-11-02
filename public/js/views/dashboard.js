import { icon } from '../icons.js';
import { api, installApk } from '../api.js';
import { state, subscribe, selectedAdbDevice, update } from '../store.js';
import { esc, formatKb, formatPercent, formatTemp, sparklineMarkup, formatTime, deviceName } from '../dom.js';
import { toast, toastError } from '../components/toast.js';
import { confirmModal, openModal } from '../components/modal.js';
import { openAddDeviceModal } from '../components/device-modal.js';
import { runTaskModal } from '../components/task-modal.js';
import { demoGuard, refreshDevices, refreshMetrics } from '../actions.js';

const QUICK_ACTIONS = [
  { id: 'reboot', title: '重启设备', description: '安全重启当前连接的设备', icon: 'power', tone: 'pink', kicker: 'SYSTEM' },
  { id: 'fastboot', title: '进入 Fastboot', description: '重启到 Bootloader 等待刷写', icon: 'flash', tone: 'blue', kicker: 'BOOTLOADER' },
  { id: 'install', title: '安装 APK', description: '从本地选择并安装应用', icon: 'upload', tone: 'violet', kicker: 'PACKAGE' },
  { id: 'screenshot', title: '屏幕截图', description: '截取当前屏幕并保存到本地', icon: 'camera', tone: 'mint', kicker: 'CAPTURE' }
];

function quickCard(action) {
  return '<button class="quick-card quick-card--' + action.tone + ' sheen" type="button" data-quick="' + action.id + '">' +
    '<span class="quick-card__top"><span class="quick-card__icon">' + icon(action.icon) + '</span><span class="quick-card__kicker">' + action.kicker + '</span></span>' +
    '<h3>' + action.title + '</h3><p>' + action.description + '</p>' +
    '<span class="quick-card__footer">执行 ' + icon('arrowRight') + '<span class="quick-card__accent"></span></span>' +
  '</button>';
}

function logMarkup(entry) {
  const time = formatTime(entry.ts);
  const level = entry.level || 'info';
  return '<div class="log-row log-row--' + level + '"><span class="log-row__time">[' + time + ']</span><span class="log-row__bullet">•</span><span class="log-row__message">' + esc(entry.message) + '</span></div>';
}

function gaugeCard(label, value, unit, color, history, detail, digits = 0) {
  const safe = value == null || !Number.isFinite(Number(value)) ? null : Number(value);
  return '<div class="metric-card">' +
    '<div class="metric-card__top"><span>' + label + '</span><span>实时</span></div>' +
    '<div class="metric-card__body">' +
      '<div class="gauge" style="--p:' + (safe == null ? 0 : Math.max(0, Math.min(100, safe))) + ';--gauge:' + color + '"><span class="gauge__text">' + (safe == null ? '--' : (digits ? safe.toFixed(digits) : Math.round(safe))) + '<small>' + unit + '</small></span></div>' +
      '<div class="metric-card__meta"><div class="metric-card__value">' + (safe == null ? '--' : (digits ? safe.toFixed(digits) : Math.round(safe))) + '<small>' + unit + '</small></div>' + sparklineMarkup(history, color) + '<div class="metric-card__top" style="margin-top:1px"><span>' + detail + '</span></div></div>' +
    '</div>' +
  '</div>';
}

function perfMarkup() {
  const metrics = state.metrics;
  const device = selectedAdbDevice();
  if (!metrics && (!device || device.state !== 'device')) {
    return '<div class="perf-empty"><span class="perf-empty__ring">' + icon('activity') + '</span><strong>等待设备数据</strong><span>连接并授权设备后显示实时性能</span></div>';
  }
  if (!metrics) {
    return '<div class="perf-empty"><span class="perf-empty__ring">' + icon('activity') + '</span><strong>正在读取设备性能</strong><span>首次采样可能需要几秒</span></div>';
  }
  const memPct = metrics.memTotalKb && metrics.memUsedKb != null ? (metrics.memUsedKb / metrics.memTotalKb) * 100 : null;
  const storagePct = metrics.storageTotalKb && metrics.storageUsedKb != null ? (metrics.storageUsedKb / metrics.storageTotalKb) * 100 : null;
  const memDetail = metrics.memTotalKb ? formatKb(metrics.memUsedKb, 1) + ' / ' + formatKb(metrics.memTotalKb, 0) : '内存';
  const storageDetail = metrics.storageTotalKb ? '已使用 ' + formatKb(metrics.storageUsedKb, 0) + ' / ' + formatKb(metrics.storageTotalKb, 0) : '存储空间';
  return '<div class="perf-grid">' +
    gaugeCard('CPU 使用率', metrics.cpuPercent, '%', '#f26797', state.history.cpu, '最近 12 次采样') +
    gaugeCard('内存占用', memPct, '%', '#5b9cf8', state.history.mem, memDetail) +
  '</div>' +
  '<div class="perf-sub">' +
    '<span class="perf-pill">' + icon('thermometer') + formatTemp(metrics.temperatureC) + '</span>' +
    '<span class="perf-pill">' + icon('battery') + (metrics.batteryPercent == null ? '--' : metrics.batteryPercent + '%') + '</span>' +
    '<span class="perf-pill" style="margin-left:auto">' + icon('activity') + '实时</span>' +
  '</div>' +
  '<div class="storage-row"><div class="storage-row__head"><span>存储容量</span><b>' + formatPercent(storagePct) + '</b></div><div class="progress"><div class="progress__bar" style="width:' + Math.max(2, Math.min(100, storagePct || 0)) + '%"></div></div><div class="storage-row__head" style="margin-top:4px"><span>' + storageDetail + '</span><span>' + formatKb(metrics.storageTotalKb, 0) + '</span></div></div>';
}

function logsMarkup() {
  const items = state.logs.slice(-40);
  if (!items.length) {
    return '<div class="log-empty">' + icon('terminal') + '<span>操作日志会实时显示在这里</span></div>';
  }
  return items.map(logMarkup).join('');
}

function subtitle() {
  if (state.demo) return '当前已连接 <b>1</b> 台设备，演示数据已就绪';
  if (!state.health) return '正在检测本机 ADB 环境…';
  if (!state.health.adb || !state.health.adb.found) return '尚未检测到 ADB，请前往系统设置指定 platform-tools 路径';
  const online = (state.devices.adb || []).filter((device) => device.state === 'device');
  const active = selectedAdbDevice();
  if (!online.length) return 'ADB 已就绪 · 尚未连接设备';
  return '当前已连接 <b>' + online.length + '</b> 台设备' + (active ? ' · 正在查看 ' + esc(deviceName(active)) : '');
}

export async function mount(container, ctx) {
  container.innerHTML =
    '<div class="page-head dashboard-head">' +
      '<div class="page-head__copy"><div class="page-head__eyebrow">SAKURA WORKSPACE</div><h1 class="page-title">欢迎回来，<span>开发者</span></h1><p class="page-subtitle" data-dashboard-subtitle>' + subtitle() + '</p></div>' +
      '<div class="page-head__actions"><button class="btn btn--primary" type="button" data-action="refresh">' + icon('refresh') + '刷新设备</button><button class="btn btn--ghost" type="button" data-action="add-device">' + icon('plus') + '添加设备</button></div>' +
    '</div>' +
    '<div class="quick-head"><h2>快捷指令</h2><span>常用操作</span></div>' +
    '<div class="quick-grid" data-quick-grid>' + QUICK_ACTIONS.map(quickCard).join('') + '</div>' +
    '<div class="dashboard-grid">' +
      '<section class="logs-panel glass panel">' +
        '<div class="panel-head"><div class="panel-title"><span class="dot-live"></span>实时日志</div><div class="panel-actions"><button class="text-btn" type="button" data-log="clear">清空</button><button class="text-btn" type="button" data-log="export">' + icon('download') + '导出</button></div></div>' +
        '<div class="log-list" data-log-list>' + logsMarkup() + '</div>' +
      '</section>' +
      '<section class="perf-panel glass panel">' +
        '<div class="panel-head"><div class="panel-title">设备性能监控</div><div class="panel-actions"><button class="text-btn" type="button" data-action="metrics">' + icon('refresh') + '刷新</button></div></div>' +
        '<div data-perf-body>' + perfMarkup() + '</div>' +
      '</section>' +
    '</div>';

  const subtitleNode = container.querySelector('[data-dashboard-subtitle]');
  const logNode = container.querySelector('[data-log-list]');
  const perfNode = container.querySelector('[data-perf-body]');

  const render = () => {
    subtitleNode.innerHTML = subtitle();
    logNode.innerHTML = logsMarkup();
    logNode.scrollTop = logNode.scrollHeight;
    perfNode.innerHTML = perfMarkup();
  };

  const unsubscribe = subscribe(render);

  const requireDevice = (allowRecovery = false) => {
    const device = selectedAdbDevice();
    if (!device) {
      toast('请先连接并选择设备', 'warn', '可以点击“添加设备”查看连接方式');
      return null;
    }
    if (device.state === 'unauthorized') {
      toast('设备未授权', 'warn', '请解锁手机并在 USB 调试弹窗中点击允许');
      return null;
    }
    const usable = device.state === 'device' || (allowRecovery && ['recovery', 'sideload'].includes(device.state));
    if (!usable) {
      toast('设备当前不可操作', 'warn', '设备状态：' + device.state);
      return null;
    }
    return device;
  };

  const doReboot = async () => {
    if (demoGuard()) return;
    const device = requireDevice(true);
    if (!device) return;
    const confirmed = await confirmModal({
      title: '重启设备',
      message: '将向 ' + deviceName(device) + ' 发送重启指令。',
      confirmLabel: '确认重启',
      icon: 'power'
    });
    if (!confirmed) return;
    try {
      await api.devices.action(device.serial, 'reboot');
      toast('重启指令已发送', 'success', device.serial);
      setTimeout(() => refreshDevices({ silent: true }), 1300);
    } catch (error) {
      toastError(error);
    }
  };

  const enterFastboot = async () => {
    if (demoGuard()) return;
    const device = requireDevice(true);
    if (!device) return;
    const confirmed = await confirmModal({
      title: '进入 Fastboot',
      message: '设备将重启进入 Bootloader。进入后 USB 连接会短暂断开，这是正常现象。',
      confirmLabel: '进入 Fastboot',
      icon: 'flash',
      danger: true
    });
    if (!confirmed) return;
    try {
      await api.devices.action(device.serial, 'bootloader');
      toast('已发送进入 Fastboot 指令', 'success', '正在等待设备重新枚举');
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts += 1;
        const snapshot = await refreshDevices({ silent: true });
        if (snapshot && snapshot.fastboot && snapshot.fastboot.some((item) => item.serial === device.serial)) {
          clearInterval(timer);
          toast('设备已进入 Fastboot', 'success', '可以在刷写页继续操作');
        }
        if (attempts >= 40) clearInterval(timer);
      }, 1500);
    } catch (error) {
      toastError(error);
    }
  };

  const installApkFlow = async () => {
    if (demoGuard()) return;
    const device = requireDevice();
    if (!device) return;
    try {
      const record = await api.files.pick('apk');
      if (!record) return;
      runTaskModal({
        title: '安装应用',
        subtitle: record.name + ' · ' + (record.size ? (record.size / 1024 / 1024).toFixed(1) + ' MB' : ''),
        icon: 'upload',
        start: (handlers) => installApk(device.serial, record.token, handlers),
        successMessage: '应用安装完成',
        onComplete: () => refreshDevices({ silent: true })
      });
    } catch (error) {
      toastError(error);
    }
  };

  const takeScreenshot = async () => {
    if (demoGuard()) return;
    const device = requireDevice();
    if (!device) return;
    const dismiss = toast('正在截取设备屏幕…', 'info', device.serial);
    try {
      const shot = await api.screenshot.capture(device.serial);
      dismiss();
      const modal = openModal({
        title: '屏幕截图',
        subtitle: shot.width + ' × ' + shot.height + ' · ' + shot.filePath,
        icon: 'camera',
        width: 720,
        content: '<div style="border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.8);box-shadow:0 20px 42px -28px rgba(89,48,98,.55);background:#fff"><img src="' + shot.dataUrl + '" alt="设备截图预览" style="display:block;width:100%;max-height:56vh;object-fit:contain"></div>',
        footer: '<button class="btn btn--ghost" type="button" data-open-shot>打开所在文件夹</button><button class="btn btn--primary" type="button" data-close-shot>完成</button>',
        onMount: ({ root, close }) => {
          root.querySelector('[data-open-shot]').addEventListener('click', () => api.system.showItemInFolder(shot.filePath).catch(toastError));
          root.querySelector('[data-close-shot]').addEventListener('click', close);
        }
      });
      if (modal) toast('截图已保存', 'success', shot.filePath);
      refreshDevices({ silent: true });
    } catch (error) {
      dismiss();
      toastError(error, '截图失败');
    }
  };

  const onQuick = async (id) => {
    if (id === 'reboot') return doReboot();
    if (id === 'fastboot') return enterFastboot();
    if (id === 'install') return installApkFlow();
    if (id === 'screenshot') return takeScreenshot();
  };

  const onClick = async (event) => {
    const quick = event.target.closest('[data-quick]');
    if (quick) {
      await onQuick(quick.dataset.quick);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'refresh') await refreshDevices({ manual: true });
      if (action.dataset.action === 'add-device') openAddDeviceModal({ onRefresh: () => refreshDevices({ manual: true }), onConnected: () => refreshDevices({ manual: true }) });
      if (action.dataset.action === 'metrics') await refreshMetrics({ silent: false });
      return;
    }
    const logAction = event.target.closest('[data-log]');
    if (logAction) {
      if (demoGuard()) return;
      if (logAction.dataset.log === 'clear') {
        try {
          await api.logs.clear();
          update({ logs: [] });
          toast('日志已清空', 'success');
        } catch (error) { toastError(error); }
      }
      if (logAction.dataset.log === 'export') {
        try {
          const result = await api.logs.export();
          if (result && result.saved) toast('日志已导出', 'success', result.path);
        } catch (error) { toastError(error); }
      }
    }
  };

  container.addEventListener('click', onClick);

  const onPointerMove = (event) => {
    const card = event.target.closest('.quick-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty('--ry', (x * 4).toFixed(2) + 'deg');
    card.style.setProperty('--rx', (-y * 4).toFixed(2) + 'deg');
    card.style.setProperty('--mx', (event.clientX - rect.left) + 'px');
    card.style.setProperty('--my', (event.clientY - rect.top) + 'px');
  };
  const onPointerLeave = (event) => {
    const card = event.target.closest('.quick-card');
    if (!card) return;
    card.style.setProperty('--ry', '0deg');
    card.style.setProperty('--rx', '0deg');
  };

  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerleave', onPointerLeave, true);

  if (!state.demo && !state.metrics) refreshMetrics({ silent: true });

  return () => {
    unsubscribe();
    container.removeEventListener('click', onClick);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerleave', onPointerLeave, true);
  };
}