import { icon } from '../icons.js';
import { api } from '../api.js';
import { state, subscribe, selectedAdbDevice } from '../store.js';
import { esc, hashHue, initials, deviceName } from '../dom.js';
import { toast, toastError } from '../components/toast.js';
import { openModal } from '../components/modal.js';
import { demoGuard } from '../actions.js';

const METHOD_CLASS = { adb: 'adb', owner: 'owner', grant: 'grant' };

function statusText(app) {
  if (!app.installed) return { label: '未安装', cls: 'is-off' };
  if (app.active) return { label: '已激活', cls: 'is-active' };
  if (app.level === 'guide') return { label: '需引导', cls: 'is-guide' };
  return { label: '未激活', cls: 'is-off' };
}

function cardMarkup(app) {
  const hue = hashHue(app.package);
  const name = app.label || app.name;
  const status = statusText(app);
  const canRun = app.installed && app.level === 'oneclick' && !app.active;
  const action = app.active && app.level === 'oneclick'
    ? '<button class="btn btn--ghost btn--sm" type="button" disabled>' + icon('checkCircle') + '已激活</button>'
    : canRun
      ? '<button class="btn btn--primary btn--sm" type="button" data-act-run="' + esc(app.id) + '">' + esc(app.actionLabel || '开始激活') + '</button>'
      : app.installed
        ? '<button class="btn btn--primary btn--sm" type="button" data-act-detail="' + esc(app.id) + '">查看步骤</button>'
        : '<button class="btn btn--ghost btn--sm" type="button" disabled>未安装</button>';
  return '<article class="activate-card glass ' + (app.installed ? 'is-installed' : 'is-missing') + ' ' + (app.active ? 'is-active' : '') + '" data-act-id="' + esc(app.id) + '">' +
    '<div class="activate-card__head">' +
      '<span class="activate-icon" style="--hue:' + hue + '">' + (app.icon ? '<img src="' + app.icon + '" alt="" loading="lazy">' : esc(initials(name))) + '</span>' +
      '<span class="activate-title"><strong>' + esc(name) + '</strong><span>' + esc(app.package) + '</span></span>' +
      '<span class="activate-pill activate-pill--' + (METHOD_CLASS[app.method] || 'owner') + '">' + esc(app.methodLabel) + '</span>' +
    '</div>' +
    '<p class="activate-card__desc">' + esc(app.summary) + '</p>' +
    '<div class="activate-card__meta">' +
      '<span class="activate-status ' + status.cls + '"><i></i>' + status.label + '</span>' +
      (app.level === 'guide' ? '<span class="activate-status is-guide"><i></i>安全引导</span>' : '<span class="activate-status is-oneclick"><i></i>可一键</span>') +
    '</div>' +
    '<div class="activate-card__actions">' + action +
      '<button class="btn btn--ghost btn--sm" type="button" data-act-detail="' + esc(app.id) + '">详情</button>' +
      (app.installed ? '<button class="btn btn--ghost btn--sm" type="button" data-act-open="' + esc(app.id) + '">打开</button>' : '') +
    '</div>' +
  '</article>';
}

function skeletonMarkup() {
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += '<div class="activate-card glass"><div class="activate-card__head"><span class="skeleton" style="width:40px;height:40px;border-radius:12px"></span><span style="flex:1"><span class="skeleton" style="display:block;width:120px;height:10px"></span><span class="skeleton" style="display:block;width:180px;height:8px;margin-top:6px"></span></span></div><span class="skeleton" style="display:block;width:90%;height:8px;margin-top:10px"></span><span class="skeleton" style="display:block;width:60%;height:8px;margin-top:6px"></span></div>';
  }
  return out;
}

export async function mount(container) {
  let data = null;
  let loading = false;
  let error = '';
  let requestSeed = 0;
  let lastSerial = state.activeAdbSerial;

  container.innerHTML =
    '<div class="page-head"><div class="page-head__copy"><div class="page-head__eyebrow">NO-ROOT ACTIVATION</div><h1 class="page-title">免Root<span>激活</span></h1><p class="page-subtitle" data-act-subtitle>连接设备后读取可激活应用</p></div><div class="page-head__actions"><button class="btn btn--ghost" type="button" data-act-refresh>' + icon('refresh') + '刷新状态</button></div></div>' +
    '<div class="activate-note glass" data-act-note></div>' +
    '<div class="activate-stats" data-act-stats></div>' +
    '<div class="activate-grid" data-act-grid></div>';

  const subtitleNode = container.querySelector('[data-act-subtitle]');
  const noteNode = container.querySelector('[data-act-note]');
  const statsNode = container.querySelector('[data-act-stats]');
  const gridNode = container.querySelector('[data-act-grid]');

  const currentDevice = () => selectedAdbDevice();
  const findApp = (id) => (data && data.apps || []).find((item) => item.id === id);

  const renderSubtitle = () => {
    const device = currentDevice();
    if (state.demo) { subtitleNode.textContent = '演示模式 · 仅展示界面，不执行 ADB 命令'; return; }
    if (!device) { subtitleNode.textContent = '请先连接并选择一台 ADB 设备'; return; }
    if (error) { subtitleNode.textContent = '设备 ' + deviceName(device) + ' · 状态读取失败'; return; }
    const apps = (data && data.apps) || [];
    const installed = apps.filter((item) => item.installed).length;
    const oneclick = apps.filter((item) => item.installed && item.level === 'oneclick').length;
    subtitleNode.innerHTML = '设备 <b>' + esc(deviceName(device)) + '</b> · 已安装 <b>' + installed + '</b>/' + (apps.length || 11) + ' · 可一键 <b>' + oneclick + '</b>';
  };

  const renderNote = () => {
    if (state.demo) {
      noteNode.innerHTML = '<span class="activate-note__icon">' + icon('sparkles') + '</span><div class="activate-note__copy"><strong>演示模式</strong><span>连接真实设备后才能读取激活状态。</span></div>';
      return;
    }
    if (!data) {
      noteNode.innerHTML = '<span class="activate-note__icon">' + icon('shield') + '</span><div class="activate-note__copy"><strong>安全模式</strong><span>本页不会自动移除账户或设置设备所有者。连接设备后会检测账户和设备所有者状态。</span></div>';
      return;
    }
    const accounts = Number.isFinite(data.accounts) ? data.accounts : 0;
    const owner = data.owner;
    noteNode.innerHTML = '<span class="activate-note__icon">' + icon('shield') + '</span><div class="activate-note__copy"><strong>安全模式</strong><span>本页不会自动移除账户或设置设备所有者。' +
      (owner ? '当前设备所有者：<code>' + esc(owner) + '</code>' : '当前没有设备所有者') +
      (accounts ? '，检测到 <b>' + accounts + '</b> 个账户。' : '。') +
      '设备所有者类应用只提供官方步骤，请自行确认风险。</span></div>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-act-accounts>' + icon('user') + '账户设置</button>';
  };

  const renderStats = () => {
    const apps = (data && data.apps) || [];
    if (!apps.length) { statsNode.innerHTML = ''; return; }
    const installed = apps.filter((item) => item.installed).length;
    const oneclick = apps.filter((item) => item.installed && item.level === 'oneclick').length;
    const guide = apps.filter((item) => item.installed && item.level === 'guide').length;
    const missing = apps.filter((item) => !item.installed).length;
    statsNode.innerHTML =
      '<span class="activate-stat"><b>' + installed + '</b> 已安装</span>' +
      '<span class="activate-stat is-green"><b>' + oneclick + '</b> 可一键</span>' +
      '<span class="activate-stat is-amber"><b>' + guide + '</b> 需引导</span>' +
      '<span class="activate-stat"><b>' + missing + '</b> 未安装</span>' +
      (data && data.owner ? '<span class="activate-stat is-green"><b>已设置</b> 设备所有者</span>' : '<span class="activate-stat"><b>无</b> 设备所有者</span>');
  };

  const renderGrid = () => {
    if (loading) { gridNode.innerHTML = skeletonMarkup(); return; }
    if (error) {
      gridNode.innerHTML = '<div class="empty-state glass activate-empty"><span class="empty-state__art">' + icon('alert') + '</span><strong>激活状态读取失败</strong><p>' + esc(error) + '</p><button class="btn btn--primary btn--sm" type="button" data-act-refresh>重试</button></div>';
      return;
    }
    if (state.demo) {
      gridNode.innerHTML = '<div class="empty-state glass activate-empty"><span class="empty-state__art">' + icon('sparkles') + '</span><strong>演示模式</strong><p>连接真实设备后，这里会列出 Shizuku、黑阈、冰箱等 11 个激活项目。</p></div>';
      return;
    }
    if (!currentDevice()) {
      gridNode.innerHTML = '<div class="empty-state glass activate-empty"><span class="empty-state__art">' + icon('smartphone') + '</span><strong>等待设备</strong><p>免Root激活需要一台已授权的在线 ADB 设备。</p></div>';
      return;
    }
    const apps = (data && data.apps) || [];
    if (!apps.length) {
      gridNode.innerHTML = '<div class="empty-state glass activate-empty"><span class="empty-state__art">' + icon('sparkles') + '</span><strong>没有可显示的激活项目</strong><p>点击刷新重新读取设备状态。</p></div>';
      return;
    }
    gridNode.innerHTML = apps.map(cardMarkup).join('');
  };

  const render = () => {
    renderSubtitle();
    renderNote();
    renderStats();
    renderGrid();
  };

  async function load(options = {}) {
    const seed = ++requestSeed;
    const device = currentDevice();
    if (state.demo) {
      data = null; loading = false; error = '';
      render();
      return;
    }
    if (!device) {
      data = null; loading = false; error = '';
      render();
      return;
    }
    if (device.state !== 'device') {
      data = null; loading = false; error = '设备当前状态为 ' + device.state + '，无法执行激活';
      render();
      return;
    }
    loading = true; error = '';
    render();
    try {
      const result = await api.activate.list(device.serial);
      if (seed !== requestSeed) return;
      data = result; loading = false;
      render();
      if (options.notify) toast('激活状态已刷新', 'success', (result.apps || []).filter((item) => item.installed).length + ' 个应用已安装');
    } catch (err) {
      if (seed !== requestSeed) return;
      loading = false; error = err.message || '激活状态读取失败'; data = null;
      render();
      if (!options.silent) toastError(err, '读取激活状态失败');
    }
  }

  function copyText(text) {
    if (!text) return;
    const done = () => toast('命令已复制', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      return;
    }
    fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch { toast('复制失败，请手动选择命令', 'warn'); }
    area.remove();
  }

  async function runApp(id, button) {
    if (demoGuard()) return;
    const device = currentDevice();
    if (!device) { toast('请先选择设备', 'warn'); return; }
    const app = findApp(id);
    if (!app) return;
    if (!app.installed) { toast(app.name + ' 尚未安装', 'warn'); return; }
    const oldText = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = '激活中…'; }
    try {
      const result = await api.activate.run(device.serial, id);
      toast(app.name + ' 激活完成', 'success', String(result.output || '').split(/\r?\n/).slice(-1)[0] || app.name + ' 已就绪');
      await load({ silent: true });
    } catch (err) {
      toastError(err, app.name + ' 激活失败');
    } finally {
      if (button) { button.disabled = false; button.textContent = oldText; }
    }
  }

  async function openApp(id) {
    if (demoGuard()) return;
    const device = currentDevice();
    if (!device) { toast('请先选择设备', 'warn'); return; }
    try {
      await api.activate.open(device.serial, id);
    } catch (err) {
      toastError(err, '打开应用失败');
    }
  }

  async function openAccounts() {
    if (demoGuard()) return;
    const device = currentDevice();
    if (!device) { toast('请先选择设备', 'warn'); return; }
    try {
      await api.activate.accounts(device.serial);
      toast('已打开账户设置', 'success', '退出账户后，再按应用内引导设置设备所有者');
    } catch (err) {
      toastError(err, '打开账户设置失败');
    }
  }

  function openDetail(id) {
    const app = findApp(id);
    if (!app) return;
    const status = statusText(app);
    const steps = (app.steps || []).map((step) => '<li>' + esc(step) + '</li>').join('');
    const command = app.command
      ? '<div class="activate-command"><div class="activate-command__head"><span>ADB 命令</span><button class="activate-copy" type="button" data-copy>' + icon('copy') + '复制</button></div><pre>' + esc(app.command) + '</pre></div>'
      : '';
    const warning = app.warning
      ? '<div class="activate-warning">' + icon('alert') + '<span>' + esc(app.warning) + '</span></div>'
      : '';
    const footer = '<button class="btn btn--ghost" type="button" data-close>关闭</button>' +
      (app.installed ? '<button class="btn btn--ghost" type="button" data-open>' + icon('external') + '打开应用</button>' : '') +
      (app.installed && app.level === 'oneclick' ? '<button class="btn btn--primary" type="button" data-run>' + esc(app.actionLabel || '开始激活') + '</button>' : '') +
      (app.method === 'owner' ? '<button class="btn btn--ghost" type="button" data-accounts>' + icon('user') + '账户设置</button>' : '');
    openModal({
      title: app.name,
      subtitle: app.package + ' · ' + app.methodLabel,
      icon: 'sparkles',
      width: 600,
      content: '<div class="activate-detail">' +
        '<div class="activate-detail__top"><span class="activate-status ' + status.cls + '"><i></i>' + status.label + '</span><span class="activate-pill activate-pill--' + (METHOD_CLASS[app.method] || 'owner') + '">' + esc(app.methodLabel) + '</span></div>' +
        '<p class="activate-detail__summary">' + esc(app.summary) + '</p>' +
        '<ol class="activate-steps">' + steps + '</ol>' +
        command + warning +
      '</div>',
      footer,
      onMount: ({ root, close }) => {
        const closeBtn = root.querySelector('[data-close]');
        if (closeBtn) closeBtn.addEventListener('click', close);
        const copyBtn = root.querySelector('[data-copy]');
        if (copyBtn) copyBtn.addEventListener('click', () => copyText(app.command));
        const openBtn = root.querySelector('[data-open]');
        if (openBtn) openBtn.addEventListener('click', async () => { close(); await openApp(app.id); });
        const accountsBtn = root.querySelector('[data-accounts]');
        if (accountsBtn) accountsBtn.addEventListener('click', async () => { close(); await openAccounts(); });
        const runBtn = root.querySelector('[data-run]');
        if (runBtn) runBtn.addEventListener('click', async () => { close(); await runApp(app.id); });
      }
    });
  }

  const onClick = async (event) => {
    if (event.target.closest('[data-act-refresh]')) { await load({ notify: true }); return; }
    if (event.target.closest('[data-act-accounts]')) { await openAccounts(); return; }
    const runBtn = event.target.closest('[data-act-run]');
    if (runBtn) { await runApp(runBtn.dataset.actRun, runBtn); return; }
    const detailBtn = event.target.closest('[data-act-detail]');
    if (detailBtn) { openDetail(detailBtn.dataset.actDetail); return; }
    const openBtn = event.target.closest('[data-act-open]');
    if (openBtn) { await openApp(openBtn.dataset.actOpen); }
  };

  container.addEventListener('click', onClick);
  const unsubscribe = subscribe(() => {
    const serial = state.activeAdbSerial;
    if (serial !== lastSerial) {
      lastSerial = serial;
      load({ silent: true });
    } else {
      renderSubtitle();
    }
  });
  render();
  await load({ silent: true });

  return () => {
    unsubscribe();
    container.removeEventListener('click', onClick);
  };
}