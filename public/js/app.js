import { icon } from './icons.js';
import { esc, formatTime, routeTitle } from './dom.js';
import { api, hasBridge, onLog } from './api.js';
import { state, subscribe, update, addLog, setDevices, reconcileSelections, setActiveAdb, setActiveFastboot, selectedAdbDevice } from './store.js';
import { isDemoMode, seedDemoState } from './demo.js';
import { createSidebar } from './components/sidebar.js';
import { createTopbar } from './components/topbar.js';
import { toast, toastError } from './components/toast.js';
import { openModal } from './components/modal.js';
import { openAddDeviceModal } from './components/device-modal.js';
import { createRouter } from './router.js';
import { refreshDevices, refreshMetrics } from './actions.js';
import * as dashboard from './views/dashboard.js';
import * as devices from './views/devices.js';
import * as apps from './views/apps.js';
import * as activate from './views/activate.js';
import * as flash from './views/flash.js';
import * as wipe from './views/wipe.js';
import * as terminal from './views/terminal.js';
import * as settings from './views/settings.js';

const routes = {
  '/dashboard': { title: '工作台', mount: dashboard.mount },
  '/devices': { title: '设备管理', mount: devices.mount },
  '/apps': { title: '应用管理', mount: apps.mount },
  '/activate': { title: '免Root激活', mount: activate.mount },
  '/flash': { title: 'Fastboot 刷写', mount: flash.mount },
  '/wipe': { title: '双清', mount: wipe.mount },
  '/terminal': { title: '终端', mount: terminal.mount },
  '/settings': { title: '系统设置', mount: settings.mount }
};

const bootNode = document.getElementById('boot');
const appNode = document.getElementById('app');

let sidebar = null;
let topbar = null;
let router = null;
let banner = null;
let bannerSignature = '';
let deviceTimer = null;
let metricsTimer = null;
let metricsBusy = false;
let logUnsubscribe = null;

function applyReducedMotion(value) {
  document.documentElement.classList.toggle('reduced-motion', Boolean(value));
}

function showBanner(options) {
  if (!banner) return;
  const signature = JSON.stringify(options || null);
  if (signature === bannerSignature) return;
  bannerSignature = signature;
  if (!options) {
    banner.classList.add('is-hidden');
    banner.innerHTML = '';
    return;
  }
  banner.className = 'app-banner' + (options.danger ? ' app-banner--danger' : '');
  banner.innerHTML = '<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:8px;background:rgba(255,255,255,.55)">' + icon(options.icon || 'alert') + '</span><div><strong>' + esc(options.title || '') + '</strong>' + (options.detail ? ' · ' + esc(options.detail) : '') + '</div>' + (options.route ? '<button class="btn btn--ghost btn--sm" type="button" data-banner-route="' + esc(options.route) + '">' + esc(options.action || '打开设置') + '</button>' : '');
}

function renderBanner() {
  if (state.demo) {
    showBanner(null);
    return;
  }
  if (state.errorBanner) {
    showBanner({ title: '设备通信异常', detail: state.errorBanner, danger: true, icon: 'alert' });
    return;
  }
  if (state.health && state.health.adb && !state.health.adb.found) {
    showBanner({ title: '未检测到 ADB', detail: '请安装 platform-tools 或在设置中指定路径', icon: 'usb', route: '/settings', action: '去设置' });
    return;
  }
  showBanner(null);
}

function navigate(path) {
  if (router) router.navigate(path);
}

function openSearchPalette() {
  const pages = [
    { route: '/dashboard', label: '工作台', icon: 'dashboard', hint: '总览' },
    { route: '/devices', label: '设备管理', icon: 'smartphone', hint: '多设备' },
    { route: '/apps', label: '应用管理', icon: 'apps', hint: 'APK' },
    { route: '/activate', label: '免Root激活', icon: 'sparkles', hint: 'Shizuku / 黑阈' },
    { route: '/flash', label: 'Fastboot 刷写', icon: 'flash', hint: '镜像' },
    { route: '/wipe', label: '双清', icon: 'trash', hint: '数据' },
    { route: '/terminal', label: '应用内终端', icon: 'terminal', hint: 'ADB' },
    { route: '/settings', label: '系统设置', icon: 'settings', hint: '路径' }
  ];
  const actions = [
    { id: 'refresh', label: '刷新设备列表', icon: 'refresh', hint: '操作' },
    { id: 'add-device', label: '添加或连接设备', icon: 'plus', hint: '操作' },
    { id: 'terminal', label: '打开 ADB 终端', icon: 'command', hint: '操作' },
    { id: 'devices', label: '查看已连接设备', icon: 'usb', hint: '操作' }
  ];
  let focused = 0;
  let last = null;

  const modal = openModal({
    title: '搜索功能',
    subtitle: '跳转到页面，或执行一个快捷动作',
    icon: 'search',
    width: 620,
    className: 'palette-modal',
    content: '<div class="palette-search">' + icon('search') + '<input class="input" data-palette-input placeholder="搜索页面或动作…" autocomplete="off" spellcheck="false" data-autofocus></div><div class="palette-results" data-palette-results></div>',
    onMount: ({ root, close }) => {
      const input = root.querySelector('[data-palette-input]');
      const results = root.querySelector('[data-palette-results]');

      const all = [
        ...pages.map((page) => ({ ...page, kind: 'page' })),
        ...actions.map((action) => ({ ...action, kind: 'action' }))
      ];

      const matches = () => {
        const query = input.value.trim().toLowerCase();
        if (!query) return all;
        return all.filter((item) => (item.label + ' ' + (item.hint || '') + ' ' + (item.route || '') + ' ' + (item.id || '')).toLowerCase().includes(query));
      };

      const activate = (item) => {
        if (!item) return;
        close();
        if (item.kind === 'page') {
          navigate(item.route);
          return;
        }
        if (item.id === 'refresh') {
          refreshDevices({ manual: true });
          return;
        }
        if (item.id === 'add-device') {
          openAddDeviceModal({ onRefresh: () => refreshDevices({ manual: true }), onConnected: () => refreshDevices({ manual: true }) });
          return;
        }
        if (item.id === 'terminal') {
          navigate('/terminal');
          return;
        }
        if (item.id === 'devices') {
          navigate('/devices');
        }
      };

      const render = () => {
        last = matches();
        focused = Math.min(focused, Math.max(0, last.length - 1));
        if (!last.length) {
          results.innerHTML = '<div class="palette-empty">没有匹配的结果</div>';
          return;
        }
        results.innerHTML = last.map((item, index) => {
          const left = item.kind === 'page' ? item.route : item.id;
          return '<button class="palette-item ' + (index === focused ? 'is-focused' : '') + '" type="button" data-palette-index="' + index + '"><span class="palette-item__icon">' + icon(item.icon) + '</span><span class="palette-item__label">' + esc(item.label) + '</span><span class="palette-item__hint">' + esc(item.hint || left || '') + '</span></button>';
        }).join('');
      };

      results.addEventListener('click', (event) => {
        const item = event.target.closest('[data-palette-index]');
        if (!item) return;
        activate(last[Number(item.dataset.paletteIndex)]);
      });

      input.addEventListener('input', () => { focused = 0; render(); });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          focused = Math.min(last.length - 1, focused + 1);
          render();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          focused = Math.max(0, focused - 1);
          render();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          activate(last[focused]);
        }
      });
      render();
      requestAnimationFrame(() => input.focus());
    }
  });
  return modal;
}

function openNotifications() {
  const items = state.logs.slice(-14).reverse();
  const content = items.length
    ? '<div class="notification-list">' + items.map((item) => '<div class="notification-item"><span class="notification-item__dot" style="background:' + (item.level === 'error' ? 'var(--danger)' : item.level === 'warn' ? 'var(--amber)' : item.level === 'success' ? 'var(--mint)' : 'var(--pink)') + '"></span><div class="notification-item__body"><strong>' + esc(item.message) + '</strong><span>' + esc((item.source || 'system') + ' · ' + formatTime(item.ts)) + '</span></div></div>').join('') + '</div>'
    : '<div class="empty-state" style="min-height:160px"><span class="empty-state__art">' + icon('bell') + '</span><strong>还没有操作记录</strong><p>连接设备或执行一次操作后，最近日志会显示在这里。</p></div>';
  const modal = openModal({
    title: '最近操作',
    subtitle: '来自主进程的实时日志',
    icon: 'bell',
    width: 600,
    content,
    footer: '<button class="btn btn--ghost" type="button" data-notif-clear>清空日志</button><button class="btn btn--primary" type="button" data-notif-close>完成</button>',
    onMount: ({ root, close }) => {
      root.querySelector('[data-notif-close]').addEventListener('click', close);
      root.querySelector('[data-notif-clear]').addEventListener('click', async () => {
        if (state.demo) {
          update({ logs: [] });
          toast('演示日志已清空', 'success');
          close();
          return;
        }
        try {
          await api.logs.clear();
          update({ logs: [] });
          toast('日志已清空', 'success');
          close();
        } catch (error) {
          toastError(error);
        }
      });
    }
  });
  return modal;
}

async function initialLoad() {
  if (!hasBridge()) {
    update({ errorBanner: '无法连接 Electron 主进程' });
    return;
  }
  const [healthRes, settingsRes, devicesRes, logsRes] = await Promise.allSettled([
    api.system.health(),
    api.settings.get(),
    api.devices.list(),
    api.logs.list()
  ]);
  if (healthRes.status === 'fulfilled') {
    state.health = healthRes.value;
    state.tools = healthRes.value.tools;
  } else {
    state.errorBanner = healthRes.reason?.message || '无法读取 ADB 环境';
  }
  if (settingsRes.status === 'fulfilled') {
    state.settings = settingsRes.value.settings || {};
    applyReducedMotion(state.settings.reducedMotion);
  }
  if (devicesRes.status === 'fulfilled') {
    state.devices = {
      adb: devicesRes.value.adb || [],
      fastboot: devicesRes.value.fastboot || [],
      errors: devicesRes.value.errors || [],
      checkedAt: devicesRes.value.checkedAt || new Date().toISOString()
    };
    reconcileSelections(state.devices);
    state.lastRefresh = state.devices.checkedAt;
  } else if (!state.errorBanner) {
    state.errorBanner = devicesRes.reason?.message || '无法读取设备列表';
  }
  if (logsRes.status === 'fulfilled') state.logs = logsRes.value.entries || [];
  update({});
  if (!state.demo) {
    logUnsubscribe = onLog((entry) => addLog(entry));
  }
  if (state.errorBanner) toastError(new Error(state.errorBanner), '环境初始化失败');
  else setTimeout(() => refreshMetrics({ silent: true }), 350);
}

function startDevicePolling() {
  if (state.demo) return () => {};
  let disposed = false;
  const loop = async () => {
    if (disposed) return;
    if (!document.hidden) await refreshDevices({ silent: true });
    deviceTimer = setTimeout(loop, 4000);
  };
  deviceTimer = setTimeout(loop, 1600);
  return () => {
    disposed = true;
    if (deviceTimer) clearTimeout(deviceTimer);
  };
}

function syncMetricsPolling() {
  if (metricsTimer) {
    clearTimeout(metricsTimer);
    metricsTimer = null;
  }
  if (state.demo) return;
  if (!['/dashboard', '/devices'].includes(state.route)) return;
  let disposed = false;
  const loop = async () => {
    if (disposed) return;
    if (!metricsBusy && !document.hidden) {
      metricsBusy = true;
      await refreshMetrics({ silent: true });
      metricsBusy = false;
    }
    metricsTimer = setTimeout(loop, 5000);
  };
  metricsTimer = setTimeout(loop, 500);
}

function setupShell() {
  const demo = isDemoMode();
  state.demo = demo;
  state.qa = new URLSearchParams(window.location.search).get('qa') === '1';
  if (state.qa) document.documentElement.classList.add('qa-capture');
  document.body.classList.toggle('demo-mode', demo);

  if (demo) {
    const seeded = seedDemoState();
    Object.assign(state, seeded);
    state.demo = true;
    applyReducedMotion(Boolean(state.settings && state.settings.reducedMotion));
  }

  const shell = document.createElement('div');
  shell.className = 'shell';

  const main = document.createElement('main');
  main.className = 'main';
  const viewWrap = document.createElement('div');
  viewWrap.className = 'view-wrap scroll-area';
  viewWrap.id = 'view-wrap';
  banner = document.createElement('div');
  banner.className = 'app-banner is-hidden';
  banner.id = 'app-banner';
  banner.addEventListener('click', (event) => {
    const route = event.target.closest('[data-banner-route]');
    if (route) navigate(route.dataset.bannerRoute);
  });

  sidebar = createSidebar({
    onNavigate: navigate,
    onAddDevice: () => openAddDeviceModal({ onRefresh: () => refreshDevices({ manual: true }), onConnected: () => refreshDevices({ manual: true }) }),
    onSelectDevice: (serial, mode) => {
      if (mode === 'fastboot') {
        setActiveFastboot(serial);
        toast('已切换 Fastboot 设备', 'success', serial);
      } else {
        setActiveAdb(serial);
        const device = state.devices.adb.find((item) => item.serial === serial);
        toast('已切换当前设备', 'success', device ? (device.model || serial) : serial);
      }
      if (['/dashboard', '/devices'].includes(state.route)) refreshMetrics({ silent: true });
    }
  });

  topbar = createTopbar({
    onNavigate: navigate,
    onSearch: openSearchPalette,
    onRefresh: async () => {
      await refreshDevices({ manual: true });
      toast('设备列表已刷新', 'info');
    },
    onNotifications: openNotifications
  });

  main.appendChild(topbar.element);
  main.appendChild(banner);
  main.appendChild(viewWrap);
  shell.appendChild(sidebar.element);
  shell.appendChild(main);
  appNode.replaceChildren(shell);

  router = createRouter({
    container: viewWrap,
    routes,
    onRoute: (route) => {
      state.route = route;
      document.title = routeTitle(route) + ' · Sakura ADB Toolbox';
      update({ route });
      syncMetricsPolling();
      if (!state.demo && route === '/dashboard') refreshMetrics({ silent: true });
    }
  });

  subscribe(() => {
    sidebar.update(state, state.route);
    topbar.update(state, state.route);
    renderBanner();
  });

  sidebar.update(state, state.route);
  topbar.update(state, state.route);
  renderBanner();
  router.start();

  if (state.demo) {
    setTimeout(() => refreshMetrics(), 0);
  }

  if (!document.hidden && !state.demo) startDevicePolling();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.demo) {
      refreshDevices({ silent: true });
      refreshMetrics({ silent: true });
    }
  });

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearchPalette();
      return;
    }
    if (event.key === '/' && !typing) {
      event.preventDefault();
      openSearchPalette();
    }
  });

  api.window.isMaximized().then((result) => topbar.setMaximized(Boolean(result && result.maximized))).catch(() => {});
  api.window.onMaximizedChange((payload) => topbar.setMaximized(Boolean(payload && payload.maximized)));

  if (state.demo) {
    document.documentElement.classList.add('demo-mode');
    update({ route: state.route });
  }

  setTimeout(() => {
    if (bootNode) {
      bootNode.classList.add('is-hidden');
      setTimeout(() => bootNode.remove(), 700);
    }
  }, state.demo ? 260 : 620);

  if (state.qa) {
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
  }

  if (!state.demo) initialLoad();
}

if (!appNode) {
  console.error('Missing #app');
} else {
  setupShell();
}
