import { icon } from '../icons.js';
import { api } from '../api.js';
import { state, subscribe, setActiveAdb, setActiveFastboot, selectedAdbDevice, selectedFastbootDevice } from '../store.js';
import { esc, hashHue, statusMeta, deviceName, formatTime } from '../dom.js';
import { toast, toastError } from '../components/toast.js';
import { confirmModal } from '../components/modal.js';
import { openAddDeviceModal } from '../components/device-modal.js';
import { demoGuard, refreshDevices } from '../actions.js';

const REBOOT_ROWS = [
  { mode: 'system', label: '系统模式下重启到', targets: [{ id: 'system', label: '系统' }, { id: 'recovery', label: '恢复模式' }, { id: 'bootloader', label: '引导模式' }, { id: 'download', label: 'Download' }] },
  { mode: 'recovery', label: '恢复模式下重启到', targets: [{ id: 'system', label: '系统' }, { id: 'bootloader', label: '引导模式' }, { id: 'recovery', label: '恢复模式' }, { id: 'poweroff', label: '关机模式' }] },
  { mode: 'bootloader', label: '引导模式下重启到', targets: [{ id: 'system', label: '系统' }, { id: 'bootloader', label: '引导模式' }, { id: 'recovery', label: '恢复模式' }, { id: 'edl', label: '9008模式' }] }
];

const MODE_LABELS = { system: '系统模式', recovery: '恢复模式', bootloader: '引导模式' };
const TARGET_LABELS = { system: '系统', recovery: '恢复模式', bootloader: '引导模式', download: 'Download', poweroff: '关机模式', edl: '9008 模式' };

function stateBadge(status) {
  const meta = statusMeta(status.state);
  return '<span class="badge badge--' + meta.tone + '"><span class="badge__dot"></span>' + meta.label + '</span>';
}

function adbCard(device, active) {
  const meta = statusMeta(device.state);
  const isOnline = ['device', 'recovery', 'sideload'].includes(device.state);
  const isWireless = String(device.serial).includes(':');
  return '<article class="device-card ' + (active ? 'is-active ' : '') + (isOnline ? '' : 'is-stale') + '" data-device-card="' + esc(device.serial) + '" style="--tone:' + (meta.tone === 'online' ? '#7de3ba' : meta.tone === 'warn' ? '#ffd792' : '#ced3e7') + '">' +
    '<div class="device-card__head">' +
      '<span class="device-avatar" style="--hue:' + hashHue(device.serial) + '">' + icon('smartphone') + '</span>' +
      '<div class="device-card__title"><strong>' + esc(device.model || device.product || 'Android 设备') + '</strong><span class="device-card__serial">' + esc(device.serial) + ' · ' + esc(device.product || 'unknown') + '</span></div>' +
      stateBadge(device) +
    '</div>' +
    '<div class="device-card__meta">' +
      '<div class="device-meta"><span>连接方式</span><b>' + (isWireless ? '无线 ADB' : 'USB ADB') + '</b></div>' +
      '<div class="device-meta"><span>设备代号</span><b>' + esc(device.device || '—') + '</b></div>' +
      '<div class="device-meta"><span>Transport</span><b>' + esc(device.transportId || '—') + '</b></div>' +
    '</div>' +
    '<div class="device-card__actions">' +
      '<button class="btn btn--ghost btn--sm" type="button" data-select-serial="' + esc(device.serial) + '" data-select-mode="adb">' + (active ? '当前设备' : '设为当前') + '</button>' +
      '<button class="btn btn--soft btn--sm" type="button" data-device-action="reboot" data-serial="' + esc(device.serial) + '" ' + (isOnline ? '' : 'disabled') + '>' + icon('power') + '重启</button>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-device-action="bootloader" data-serial="' + esc(device.serial) + '" ' + (isOnline ? '' : 'disabled') + '>' + icon('flash') + 'Fastboot</button>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-device-action="recovery" data-serial="' + esc(device.serial) + '" ' + (isOnline ? '' : 'disabled') + '>' + icon('rotate') + 'Recovery</button>' +
      (isWireless ? '<button class="btn btn--ghost btn--sm" type="button" data-device-action="disconnect" data-serial="' + esc(device.serial) + '">' + icon('unlink') + '断开</button>' : '') +
    '</div>' +
  '</article>';
}

function fastbootCard(device, active) {
  return '<article class="device-card ' + (active ? 'is-active ' : '') + '" style="--tone:#9fc8ff">' +
    '<div class="device-card__head">' +
      '<span class="device-avatar" style="--hue:210">' + icon('flash') + '</span>' +
      '<div class="device-card__title"><strong>Fastboot 设备</strong><span class="device-card__serial">' + esc(device.serial) + '</span></div>' +
      '<span class="badge badge--blue"><span class="badge__dot"></span>Fastboot</span>' +
    '</div>' +
    '<div class="device-card__meta">' +
      '<div class="device-meta"><span>模式</span><b>Bootloader</b></div>' +
      '<div class="device-meta"><span>可用操作</span><b>刷写 / 双清</b></div>' +
      '<div class="device-meta"><span>状态</span><b>等待指令</b></div>' +
    '</div>' +
    '<div class="device-card__actions">' +
      '<button class="btn btn--ghost btn--sm" type="button" data-select-serial="' + esc(device.serial) + '" data-select-mode="fastboot">' + (active ? '当前 Fastboot' : '设为当前') + '</button>' +
      '<button class="btn btn--soft btn--sm" type="button" data-go-flash>' + icon('upload') + '前往刷写</button>' +
    '</div>' +
  '</article>';
}

function emptyZone(kind) {
  return '<div class="panel glass" style="padding:0;overflow:hidden"><div class="empty-state">' +
    '<span class="empty-state__art">' + icon(kind === 'adb' ? 'smartphone' : 'flash') + '</span>' +
    '<strong>' + (kind === 'adb' ? '没有在线 ADB 设备' : '没有 Fastboot 设备') + '</strong>' +
    '<p>' + (kind === 'adb' ? '连接数据线，开启 USB 调试并在手机上允许授权。' : '在设备页点击 Fastboot 操作，或手动重启到 Bootloader。') + '</p>' +
    (kind === 'adb' ? '<button class="btn btn--primary btn--sm" type="button" data-add-device>' + icon('plus') + '添加设备</button>' : '') +
  '</div></div>';
}

export async function mount(container, ctx) {
  container.innerHTML =
    '<div class="page-head"><div class="page-head__copy"><div class="page-head__eyebrow">DEVICE CENTER</div><h1 class="page-title">多设备<span>管理</span></h1><p class="page-subtitle" data-device-subtitle>正在读取设备连接状态…</p></div><div class="page-head__actions"><button class="btn btn--ghost" type="button" data-refresh>' + icon('refresh') + '刷新</button><button class="btn btn--primary" type="button" data-add-device>' + icon('plus') + '添加设备</button></div></div>' +
    '<section class="device-zone"><div class="zone-head"><span class="zone-head__icon">' + icon('usb') + '</span><h2>ADB 设备</h2><span class="badge badge--muted" data-adb-count>0</span><button class="text-btn" type="button" data-refresh>刷新列表 ' + icon('refresh') + '</button></div><div class="device-grid" data-adb-grid></div></section>' +
    '<section class="device-zone"><div class="zone-head"><span class="zone-head__icon" style="color:var(--blue)">' + icon('flash') + '</span><h2>Fastboot 设备</h2><span class="badge badge--muted" data-fastboot-count>0</span></div><div class="device-grid" data-fastboot-grid></div></section>' +
    '<section class="reboot-matrix glass"><div class="zone-head"><span class="zone-head__icon" style="color:var(--pink)">' + icon('power') + '</span><h2>重启模式</h2><span class="badge badge--muted" data-reboot-mode>检测中</span></div><p class="reboot-lead">按当前连接模式选择目标。Download 主要用于三星设备，9008 仅高通 EDL；非对应模式的行会自动禁用。</p><div data-reboot-matrix></div></section>' +
    '<div class="wireless-panel glass" style="margin-top:12px"><div class="wireless-card"><h3>无线 ADB 连接</h3><p>同一 Wi-Fi 下通过 IP 与端口连接设备，无需数据线。</p><button class="btn btn--ghost btn--sm" type="button" data-add-device style="margin-top:8px">' + icon('wifi') + '打开连接面板</button></div><div class="wireless-card"><h3>USB 授权提示</h3><p>首次连接需要在手机端点击“允许 USB 调试”，否则设备会显示未授权。</p><span class="badge badge--amber" style="margin-top:8px">检查授权状态</span></div></div>';

  const adbGrid = container.querySelector('[data-adb-grid]');
  const fastbootGrid = container.querySelector('[data-fastboot-grid]');
  const subtitle = container.querySelector('[data-device-subtitle]');
  const adbCount = container.querySelector('[data-adb-count]');
  const fastbootCount = container.querySelector('[data-fastboot-count]');
  const matrixNode = container.querySelector('[data-reboot-matrix]');
  const modeBadge = container.querySelector('[data-reboot-mode]');
  let deviceMode = '';
  let modeSerial = '';
  let lastDevicesSignature = '';
  let lastSignature = '';

  const activeRebootDevice = () => selectedFastbootDevice() || selectedAdbDevice();
  const currentRebootMode = () => (selectedFastbootDevice() ? 'bootloader' : (deviceMode || 'system'));

  function matrixMarkup() {
    const device = activeRebootDevice();
    if (!device) return '<div class="reboot-empty">连接设备后显示可用的重启路径</div>';
    const current = currentRebootMode();
    return REBOOT_ROWS.map((row) => {
      const active = row.mode === current;
      return '<div class="reboot-row ' + (active ? 'is-active' : '') + '">' +
        '<span class="reboot-row__label">' + row.label + (active ? '<em>当前</em>' : '') + '</span>' +
        row.targets.map((target) => '<button class="reboot-target' + (target.id === 'edl' || target.id === 'download' ? ' is-risk' : '') + '" type="button" data-reboot-row="' + row.mode + '" data-reboot-target="' + target.id + '"' + (active ? '' : ' disabled') + '>' + target.label + '</button>').join('') +
      '</div>';
    }).join('');
  }

  async function loadMode(serial) {
    if (!serial) return;
    const fastboot = selectedFastbootDevice();
    if (fastboot && fastboot.serial === serial) {
      deviceMode = 'bootloader';
      render();
      return;
    }
    try {
      const info = await api.devices.mode(serial);
      if (modeSerial === serial) {
        deviceMode = info.mode || 'system';
        render();
      }
    } catch {
      if (modeSerial === serial) {
        deviceMode = 'system';
        render();
      }
    }
  }

  function syncMode() {
    const fastboot = selectedFastbootDevice();
    const adb = selectedAdbDevice();
    const serial = fastboot ? fastboot.serial : adb ? adb.serial : '';
    if (serial !== modeSerial) {
      modeSerial = serial;
      deviceMode = fastboot ? 'bootloader' : '';
      render();
      if (serial && !fastboot) loadMode(serial);
      return;
    }
    if (fastboot && deviceMode !== 'bootloader') {
      deviceMode = 'bootloader';
      render();
    } else if (!fastboot && adb && deviceMode === 'bootloader') {
      deviceMode = '';
      render();
      loadMode(serial);
    }
  }

  const render = () => {
    const signature = JSON.stringify(state.devices) + state.activeAdbSerial + state.activeFastbootSerial + '::' + deviceMode + '::' + modeSerial;
    if (signature === lastSignature) return;
    lastSignature = signature;
    const adb = state.devices.adb || [];
    const fastboot = state.devices.fastboot || [];
    adbGrid.innerHTML = adb.length ? adb.map((device) => adbCard(device, device.serial === state.activeAdbSerial)).join('') : emptyZone('adb');
    fastbootGrid.innerHTML = fastboot.length ? fastboot.map((device) => fastbootCard(device, device.serial === state.activeFastbootSerial)).join('') : emptyZone('fastboot');
    adbCount.textContent = String(adb.length);
    fastbootCount.textContent = String(fastboot.length);
    matrixNode.innerHTML = matrixMarkup();
    if (!activeRebootDevice()) {
      modeBadge.textContent = '等待设备';
      modeBadge.className = 'badge badge--muted';
    } else if (selectedFastbootDevice()) {
      modeBadge.textContent = '当前：引导模式';
      modeBadge.className = 'badge badge--blue';
    } else if (!deviceMode) {
      modeBadge.textContent = '检测中';
      modeBadge.className = 'badge badge--muted';
    } else {
      modeBadge.textContent = '当前：' + (MODE_LABELS[deviceMode] || deviceMode);
      modeBadge.className = deviceMode === 'recovery' ? 'badge badge--amber' : 'badge badge--muted';
    }
    if (state.demo) {
      subtitle.innerHTML = '演示数据 · <b>' + adb.length + '</b> 台 ADB 设备 · <b>' + fastboot.length + '</b> 台 Fastboot 设备';
    } else if (!state.health || !state.health.adb || !state.health.adb.found) {
      subtitle.textContent = '尚未检测到 ADB，请前往系统设置指定 platform-tools 路径';
    } else {
      const online = adb.filter((device) => ['device', 'recovery', 'sideload'].includes(device.state)).length;
      subtitle.innerHTML = '已发现 <b>' + adb.length + '</b> 台 ADB 设备，其中 <b>' + online + '</b> 台在线 · Fastboot <b>' + fastboot.length + '</b> 台';
    }
  };

  lastDevicesSignature = JSON.stringify(state.devices);
  render();
  syncMode();
  const unsubscribe = subscribe(() => {
    const nextSignature = JSON.stringify(state.devices);
    if (nextSignature !== lastDevicesSignature) {
      lastDevicesSignature = nextSignature;
      if (modeSerial) loadMode(modeSerial);
    }
    render();
    syncMode();
  });

  const onSelect = (serial, mode) => {
    if (mode === 'fastboot') {
      setActiveFastboot(serial);
      toast('已切换 Fastboot 设备', 'success', serial);
    } else {
      setActiveAdb(serial);
      const device = state.devices.adb.find((item) => item.serial === serial);
      toast('已切换当前设备', 'success', device ? deviceName(device) : serial);
    }
  };

  const doAction = async (serial, action) => {
    if (demoGuard()) return;
    if (action === 'reboot') {
      const confirmed = await confirmModal({ title: '重启设备', message: '确定要重启 ' + serial + ' 吗？', confirmLabel: '重启', icon: 'power' });
      if (!confirmed) return;
    }
    if (action === 'bootloader') {
      const confirmed = await confirmModal({ title: '进入 Fastboot', message: '设备将重启到 Bootloader，USB 连接会短暂断开。', confirmLabel: '继续', icon: 'flash', danger: true });
      if (!confirmed) return;
    }
    if (action === 'recovery') {
      const confirmed = await confirmModal({ title: '重启到 Recovery', message: '设备将重启进入 Recovery 模式。', confirmLabel: '继续', icon: 'rotate' });
      if (!confirmed) return;
    }
    try {
      if (action === 'disconnect') {
        await api.devices.disconnect(serial);
        toast('已断开无线设备', 'success', serial);
      } else {
        await api.devices.action(serial, action);
        toast(action === 'reboot' ? '重启指令已发送' : action === 'bootloader' ? '已发送进入 Fastboot 指令' : '已发送 Recovery 指令', 'success', serial);
      }
      setTimeout(() => refreshDevices({ silent: true }), 1300);
    } catch (error) {
      toastError(error);
    }
  };

  const doReboot = async (row, target) => {
    if (demoGuard()) return;
    const device = activeRebootDevice();
    if (!device) {
      toast('请先连接设备', 'warn');
      return;
    }
    const current = currentRebootMode();
    if (row !== current) {
      toast('当前不是' + (MODE_LABELS[row] || row) + '，不能执行该重启路径', 'warn');
      return;
    }
    const label = TARGET_LABELS[target] || target;
    let message = '设备将重启到 ' + label + '。';
    if (target === 'download') message = 'Download/Odin 模式主要用于三星设备；其他设备可能报错。设备将尝试重启到 Download 模式。';
    if (target === 'edl') message = '9008/EDL 是高通底层模式，进入后可能无法通过普通按键退出，需要专用工具。确定继续吗？';
    if (target === 'poweroff') message = '设备将关机。';
    if (target === 'system') message = '设备将重启进入系统。';
    const ok = await confirmModal({
      title: '重启到 ' + label,
      message,
      confirmLabel: '继续',
      icon: target === 'edl' ? 'alert' : 'power',
      danger: target === 'download' || target === 'edl'
    });
    if (!ok) return;
    try {
      await api.devices.reboot(device.serial, target);
      toast('已发送重启指令', 'success', label + ' · ' + device.serial);
      setTimeout(() => refreshDevices({ silent: true }), 1600);
    } catch (error) {
      toastError(error, '重启失败');
    }
  };

  const onClick = async (event) => {
    const refresh = event.target.closest('[data-refresh]');
    if (refresh) {
      await refreshDevices({ manual: true });
      toast('设备列表已刷新', 'info');
      return;
    }
    if (event.target.closest('[data-add-device]')) {
      openAddDeviceModal({ onRefresh: () => refreshDevices({ manual: true }), onConnected: () => refreshDevices({ manual: true }) });
      return;
    }
    const select = event.target.closest('[data-select-serial]');
    if (select) {
      onSelect(select.dataset.selectSerial, select.dataset.selectMode);
      return;
    }
    if (event.target.closest('[data-go-flash]')) {
      if (typeof ctx.navigate === 'function') ctx.navigate('/flash');
      return;
    }
    const reboot = event.target.closest('[data-reboot-target]');
    if (reboot) {
      await doReboot(reboot.dataset.rebootRow, reboot.dataset.rebootTarget);
      return;
    }
    const action = event.target.closest('[data-device-action]');
    if (action) {
      await doAction(action.dataset.serial, action.dataset.deviceAction);
    }
  };

  container.addEventListener('click', onClick);
  if (!state.demo && !state.lastRefresh) refreshDevices({ silent: true });

  return () => {
    unsubscribe();
    container.removeEventListener('click', onClick);
  };
}