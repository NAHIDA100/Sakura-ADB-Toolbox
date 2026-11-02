import { icon } from '../icons.js';
import { api } from '../api.js';

const NAV = [
  { route: '/dashboard', label: '工作台' },
  { route: '/devices', label: '设备管理' },
  { route: '/apps', label: '应用管理' },
  { route: '/activate', label: '激活' },
  { route: '/flash', label: 'Fastboot' },
  { route: '/wipe', label: '双清' },
  { route: '/terminal', label: '终端' }
];

export function createTopbar(callbacks = {}) {
  const element = document.createElement('header');
  element.className = 'topbar';
  element.innerHTML =
    '<nav class="top-nav" aria-label="主要页面"><span class="top-nav__indicator" aria-hidden="true"></span>' +
      NAV.map((item) => '<button class="top-nav__item" type="button" data-route="' + item.route + '">' + item.label + '</button>').join('') +
    '</nav>' +
    '<div class="topbar__spacer"></div>' +
    '<span class="demo-pill">' + icon('sparkles') + '演示数据</span>' +
    '<button class="search-pill" type="button" data-action="search" title="搜索功能 (Ctrl+K)" aria-label="搜索功能">' + icon('search') + '<span class="search-pill__text">搜索功能…</span><span class="kbd">Ctrl K</span></button>' +
    '<button class="icon-btn icon-btn--refresh" type="button" data-action="refresh" title="刷新设备" aria-label="刷新设备">' + icon('refresh') + '</button>' +
    '<button class="icon-btn topbar__bell" type="button" data-action="notifications" title="最近操作" aria-label="最近操作">' + icon('bell') + '</button>' +
    '<button class="topbar__user" type="button" data-route="/settings" title="系统设置" aria-label="系统设置">' + icon('user') + '</button>' +
    '<div class="window-controls">' +
      '<button class="window-btn" type="button" data-window="minimize" title="最小化" aria-label="最小化">' + icon('minus') + '</button>' +
      '<button class="window-btn" type="button" data-window="maximize" title="最大化" aria-label="最大化">' + icon('maximize') + '</button>' +
      '<button class="window-btn window-btn--close" type="button" data-window="close" title="关闭" aria-label="关闭">' + icon('close') + '</button>' +
    '</div>';

  const nav = element.querySelector('.top-nav');
  const indicator = element.querySelector('.top-nav__indicator');
  const maxButton = element.querySelector('[data-window="maximize"]');
  let activeRoute = '';

  function updateIndicator() {
    const active = nav.querySelector('.top-nav__item.is-active');
    if (!active) {
      indicator.style.opacity = '0';
      return;
    }
    indicator.style.opacity = '1';
    indicator.style.left = active.offsetLeft + 'px';
    indicator.style.width = active.offsetWidth + 'px';
  }

  function update(state, route) {
    if (route !== activeRoute) {
      activeRoute = route;
      nav.querySelectorAll('.top-nav__item').forEach((item) => {
        const isActive = item.dataset.route === route;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-current', isActive ? 'page' : 'false');
      });
      requestAnimationFrame(updateIndicator);
    }
  }

  function setMaximized(maximized) {
    if (!maxButton) return;
    maxButton.innerHTML = icon(maximized ? 'restore' : 'maximize');
    maxButton.title = maximized ? '还原' : '最大化';
    maxButton.setAttribute('aria-label', maximized ? '还原窗口' : '最大化窗口');
  }

  element.addEventListener('click', (event) => {
    const routeTarget = event.target.closest('[data-route]');
    if (routeTarget) {
      if (typeof callbacks.onNavigate === 'function') callbacks.onNavigate(routeTarget.dataset.route);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      const name = action.dataset.action;
      if (name === 'search' && callbacks.onSearch) callbacks.onSearch();
      if (name === 'refresh' && callbacks.onRefresh) callbacks.onRefresh(action);
      if (name === 'notifications' && callbacks.onNotifications) callbacks.onNotifications();
      return;
    }
    const winAction = event.target.closest('[data-window]');
    if (winAction) {
      const name = winAction.dataset.window;
      if (name === 'minimize') api.window.minimize().catch(console.error);
      if (name === 'close') api.window.close().catch(console.error);
      if (name === 'maximize') {
        api.window.toggleMaximize().then((result) => setMaximized(Boolean(result && result.maximized))).catch(console.error);
      }
    }
  });

  element.addEventListener('dblclick', (event) => {
    if (event.target.closest('button, input, .top-nav, .search-pill, .window-controls')) return;
    api.window.toggleMaximize().then((result) => setMaximized(Boolean(result && result.maximized))).catch(console.error);
  });

  window.addEventListener('resize', updateIndicator);

  return { element, update, setMaximized, updateIndicator };
}
