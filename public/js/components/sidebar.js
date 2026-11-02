import { icon } from '../icons.js';
import { esc, hashHue, statusMeta, petalBurst } from '../dom.js';

const NAV = [
  { route: '/devices', label: '设备管理', icon: 'smartphone' },
  { route: '/apps', label: '应用管理', icon: 'apps' },
  { route: '/activate', label: '免Root激活', icon: 'sparkles' },
  { route: '/flash', label: 'Fastboot 刷写', icon: 'flash' },
  { route: '/wipe', label: '双清', icon: 'trash' },
  { route: '/terminal', label: '应用内终端', icon: 'terminal' },
  { route: '/settings', label: '系统设置', icon: 'settings' }
];

function brandMark() {
  return '<svg viewBox="0 0 48 48" aria-hidden="true">' +
    '<defs><linearGradient id="brandSidebar" x1="5" y1="4" x2="43" y2="46" gradientUnits="userSpaceOnUse"><stop stop-color="#ff9bbf"/><stop offset=".52" stop-color="#ff4f8f"/><stop offset="1" stop-color="#a97bf1"/></linearGradient></defs>' +
    '<rect width="48" height="48" rx="15" fill="url(#brandSidebar)"/>' +
    '<path d="M17.8 16.4 15 12.9M30.2 16.4 33 12.9" stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity=".9"/>' +
    '<path d="M24 17.2c-6.35 0-11.5 5.15-11.5 11.5v4.9c0 2.4 1.95 4.35 4.35 4.35h14.3c2.4 0 4.35-1.95 4.35-4.35v-4.9c0-6.35-5.15-11.5-11.5-11.5Z" fill="#fff" opacity=".96"/>' +
    '<circle cx="20.1" cy="27.4" r="1.45" fill="#f04886"/><circle cx="27.9" cy="27.4" r="1.45" fill="#f04886"/>' +
    '<path d="M37.8 12.4c1.7-2.4 4.4-2.2 5.2-.6.8 1.7-1.4 4.6-4.9 4.1-.7-.1-.9-.2-1.3-.5.3-.9.6-1.9 1-3Z" fill="#fff" opacity=".62"/>' +
    '</svg>';
}

function deviceMarkup(device, mode, active, index) {
  const meta = statusMeta(device.state);
  const name = device.model || device.product || (mode === 'fastboot' ? 'Fastboot 设备' : 'Android 设备');
  return '<button class="device-chip ' + (active ? 'is-active' : '') + '" type="button" data-select-serial="' + esc(device.serial) + '" data-select-mode="' + mode + '" title="' + esc(name + ' · ' + device.serial) + '">' +
    '<span class="device-chip__avatar" style="--hue:' + hashHue(device.serial + index, 332) + '">' + icon('smartphone') + '</span>' +
    '<span class="device-chip__body"><span class="device-chip__name">' + esc(name) + '</span><span class="device-chip__meta"><b style="--tone:' + (meta.tone === 'online' ? 150 : meta.tone === 'warn' ? 35 : 210) + '">' + esc(meta.label) + '</b><em style="font-style:normal;opacity:.72">' + (mode === 'fastboot' ? 'fastboot' : esc(device.serial.slice(-8))) + '</em></span></span>' +
    '<span class="status-dot status-dot--' + meta.dot + (meta.tone === 'online' ? ' status-dot--pulse' : '') + '"></span>' +
  '</button>';
}

export function createSidebar(callbacks = {}) {
  const element = document.createElement('aside');
  element.className = 'sidebar glass';
  element.innerHTML =
    '<div class="brand" data-route="/dashboard" role="button" tabindex="0" aria-label="回到工作台">' +
      '<span class="brand__mark">' + brandMark() + '</span>' +
      '<span class="brand__text"><span class="brand__name">Sakura <em>ADB</em></span><span class="brand__sub">Device Studio</span></span>' +
      '<span class="brand__dot" data-brand-dot></span>' +
    '</div>' +
    '<div class="sidebar__scroll" data-sidebar-scroll>' +
      '<div class="section-head"><span>我的设备</span><button class="section-head__action" type="button" data-action="add-device" title="添加设备">' + icon('plus') + '</button></div>' +
      '<div class="device-list" data-device-list></div>' +
      '<div class="section-head"><span>常用工具</span></div>' +
      '<nav class="side-nav" aria-label="常用工具">' +
        '<span class="side-aura" aria-hidden="true"></span><span class="side-glow" aria-hidden="true"></span>' +
        NAV.map((item) => '<button class="side-item" type="button" data-route="' + item.route + '" title="' + item.label + '"><span class="side-item__icon">' + icon(item.icon) + '</span><span class="side-item__label">' + item.label + '</span><span class="side-item__arrow">' + icon('chevronRight') + '</span></button>').join('') +
      '</nav>' +
      '<div class="sidebar-tip"><span class="sidebar-tip__icon">' + icon('shield') + '</span><div><strong>调试提示</strong><span>保持 USB 授权与稳定供电，刷写前确认 Bootloader 已解锁。</span></div></div>' +
    '</div>' +
    '<div class="sidebar__footer"><span class="status-dot" data-footer-dot></span><span data-footer-text>正在检测 ADB</span><strong data-footer-version>v1.0.0</strong></div>';

  const deviceList = element.querySelector('[data-device-list]');
  const nav = element.querySelector('.side-nav');
  const glow = element.querySelector('.side-glow');
  const aura = element.querySelector('.side-aura');
  const items = Array.from(element.querySelectorAll('.side-item'));
  const footerDot = element.querySelector('[data-footer-dot]');
  const footerText = element.querySelector('[data-footer-text]');
  const footerVersion = element.querySelector('[data-footer-version]');
  let lastDeviceSignature = '';
  let lastRoute = '';

  function updateDeviceList(state) {
    const adb = state.devices.adb || [];
    const fastboot = state.devices.fastboot || [];
    const signature = [state.activeAdbSerial, state.activeFastbootSerial, adb.map((d) => d.serial + ':' + d.state).join('|'), fastboot.map((d) => d.serial).join('|')].join('::');
    if (signature === lastDeviceSignature) return;
    lastDeviceSignature = signature;
    const parts = [];
    adb.forEach((device, index) => {
      if (fastboot.some((item) => item.serial === device.serial)) return;
      parts.push(deviceMarkup(device, 'adb', device.serial === state.activeAdbSerial, index));
    });
    fastboot.forEach((device, index) => {
      parts.push(deviceMarkup(device, 'fastboot', device.serial === state.activeFastbootSerial, adb.length + index));
    });
    if (!parts.length) {
      parts.push('<div class="device-empty"><span class="device-empty__icon">' + icon('smartphone') + '</span><strong>未发现设备</strong><span>连接 USB 或添加无线设备</span><button type="button" data-action="add-device">添加设备</button></div>');
    }
    deviceList.innerHTML = parts.join('');
  }

  function update(state, route) {
    updateDeviceList(state);
    if (route !== lastRoute) {
      lastRoute = route;
      items.forEach((item) => {
        item.classList.toggle('is-active', item.dataset.route === route);
        item.setAttribute('aria-current', item.dataset.route === route ? 'page' : 'false');
      });
    }
    const healthy = state.demo || (state.health && state.health.adb && state.health.adb.found);
    footerDot.className = 'status-dot status-dot--' + (healthy ? 'online' : 'warn');
    footerText.textContent = state.demo ? '演示数据 · ADB 已就绪' : healthy ? 'ADB 已就绪' : '等待 ADB 路径';
    footerVersion.textContent = 'v' + ((state.health && state.health.appVersion) || '1.0.0');
  }

  function setGlow(item) {
    if (!item) return;
    glow.style.setProperty('--glow-y', item.offsetTop + 'px');
    aura.style.setProperty('--glow-y', item.offsetTop + 'px');
    glow.style.height = item.offsetHeight + 'px';
    aura.style.height = item.offsetHeight + 'px';
    nav.classList.add('is-hovering');
  }

  items.forEach((item) => {
    item.addEventListener('pointerenter', () => setGlow(item));
    item.addEventListener('pointermove', (event) => {
      const rect = item.getBoundingClientRect();
      item.style.setProperty('--mx', (event.clientX - rect.left) + 'px');
      item.style.setProperty('--my', (event.clientY - rect.top) + 'px');
    });
    item.addEventListener('click', (event) => {
      const rect = item.getBoundingClientRect();
      petalBurst(event.clientX || rect.left + rect.width / 2, event.clientY || rect.top + rect.height / 2);
    });
  });

  nav.addEventListener('pointerleave', () => nav.classList.remove('is-hovering'));

  element.addEventListener('click', (event) => {
    const navTarget = event.target.closest('[data-route]');
    if (navTarget) {
      if (typeof callbacks.onNavigate === 'function') callbacks.onNavigate(navTarget.dataset.route);
      return;
    }
    const add = event.target.closest('[data-action="add-device"]');
    if (add) {
      if (typeof callbacks.onAddDevice === 'function') callbacks.onAddDevice();
      return;
    }
    const device = event.target.closest('[data-select-serial]');
    if (device) {
      if (typeof callbacks.onSelectDevice === 'function') {
        callbacks.onSelectDevice(device.dataset.selectSerial, device.dataset.selectMode);
      }
    }
  });

  element.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('brand')) {
      event.preventDefault();
      if (typeof callbacks.onNavigate === 'function') callbacks.onNavigate('/dashboard');
    }
  });

  return { element, update };
}
