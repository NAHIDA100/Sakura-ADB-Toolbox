export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function formatBytes(bytes, digits = 1) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '--';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const num = value / Math.pow(1024, index);
  return (num >= 100 ? num.toFixed(0) : num.toFixed(digits)) + ' ' + units[index];
}

export function formatKb(kb, digits = 1) {
  if (kb == null || !Number.isFinite(Number(kb))) return '--';
  return formatBytes(Number(kb) * 1024, digits);
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--';
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
  return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
}

export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatPercent(value) {
  return value == null || !Number.isFinite(Number(value)) ? '--' : Math.round(Number(value)) + '%';
}

export function formatTemp(value) {
  return value == null || !Number.isFinite(Number(value)) ? '--' : Number(value).toFixed(1) + '°C';
}

export function formatNumber(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

export function hashHue(value, offset = 0) {
  let hash = 0;
  const text = String(value || 'sakura');
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return (hash + offset) % 360;
}

export function initials(value) {
  const text = String(value || '?').replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, '');
  return (text.slice(0, 2) || '?').toUpperCase();
}

export function statusMeta(state) {
  const map = {
    device: { label: '已连接', tone: 'online', dot: 'online' },
    fastboot: { label: 'Fastboot', tone: 'fastboot', dot: 'fastboot' },
    unauthorized: { label: '未授权', tone: 'warn', dot: 'warn' },
    offline: { label: '离线', tone: 'offline', dot: 'offline' },
    recovery: { label: 'Recovery', tone: 'violet', dot: 'warn' },
    sideload: { label: 'Sideload', tone: 'violet', dot: 'warn' },
    'no permissions': { label: '无权限', tone: 'danger', dot: 'danger' }
  };
  return map[state] || { label: state || '未知', tone: 'muted', dot: 'offline' };
}

export function deviceName(device) {
  if (!device) return '未选择设备';
  return device.model || device.product || device.serial || 'Android 设备';
}

export function sparklineMarkup(values, color = '#ff4f8f') {
  const data = Array.isArray(values) && values.length ? values.map((v) => Number(v) || 0) : [0];
  while (data.length < 2) data.push(data[0] || 0);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || Math.max(1, max * 0.15);
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 21 - ((value - min) / range) * 17;
    return [Math.round(x * 10) / 10, Math.round(Math.max(2, Math.min(22, y)) * 10) / 10];
  });
  let line = 'M' + points[0][0] + ',' + points[0][1];
  for (let i = 1; i < points.length; i += 1) line += ' L' + points[i][0] + ',' + points[i][1];
  const area = 'M0,23 ' + points.map((p) => 'L' + p[0] + ',' + p[1]).join(' ') + ' L100,23 Z';
  return `<svg class="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path class="fill" d="` + area + `" style="--spark-soft:` + color + `22"></path><path class="line" d="` + line + `" style="--spark:` + color + `"></path></svg>`;
}

export function statusDot(state, extra = '') {
  const meta = statusMeta(state);
  return `<span class="status-dot status-dot--` + meta.dot + ` ` + extra + `"></span>`;
}

export function toastIcon(type) {
  if (type === 'error') return 'alert';
  if (type === 'warn') return 'info';
  if (type === 'info') return 'info';
  return 'checkCircle';
}

export function petalBurst(clientX, clientY) {
  const host = document.body;
  for (let i = 0; i < 5; i += 1) {
    const petal = document.createElement('span');
    petal.className = 'petal';
    petal.style.left = clientX + 'px';
    petal.style.top = clientY + 'px';
    petal.style.setProperty('--px', (Math.random() * 34 - 17).toFixed(1) + 'px');
    petal.style.setProperty('--py', (-12 - Math.random() * 24).toFixed(1) + 'px');
    petal.style.animationDelay = (i * 18) + 'ms';
    host.appendChild(petal);
    setTimeout(() => petal.remove(), 900);
  }
}

export async function copyText(text) {
  const value = String(text == null ? '' : text);
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export function routeTitle(route) {
  const map = {
    '/dashboard': '工作台',
    '/devices': '设备管理',
    '/apps': '应用管理',
    '/activate': '免Root激活',
    '/flash': 'Fastboot 刷写',
    '/wipe': '双清',
    '/terminal': '终端',
    '/settings': '系统设置'
  };
  return map[route] || 'Sakura ADB Toolbox';
}
