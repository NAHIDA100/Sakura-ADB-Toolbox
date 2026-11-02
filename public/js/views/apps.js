import { icon } from '../icons.js';
import { api, installApk, exportApp } from '../api.js';
import { state, subscribe, selectedAdbDevice } from '../store.js';
import { esc, hashHue, initials, deviceName } from '../dom.js';
import { toast, toastError } from '../components/toast.js';
import { confirmModal, openModal } from '../components/modal.js';
import { runTaskModal } from '../components/task-modal.js';
import { demoGuard, refreshDevices } from '../actions.js';
import { demoApps } from '../demo.js';

const FILTERS = [
  { id: 'third', label: '第三方' },
  { id: 'system', label: '系统' },
  { id: 'all', label: '全部' },
  { id: 'frozen', label: '已冻结' }
];

const KNOWN_LABELS = {
  'com.tencent.mm': '微信',
  'com.spotify.music': 'Spotify',
  'com.google.android.youtube': 'YouTube',
  'com.instagram.android': 'Instagram',
  'com.discord': 'Discord',
  'com.netflix.mediaclient': 'Netflix',
  'com.valvesoftware.android.steam.community': 'Steam',
  'com.google.android.apps.photos': '相册',
  'com.zhiliaoapp.musically': 'TikTok',
  'org.telegram.messenger': 'Telegram',
  'com.Slack': 'Slack',
  'com.google.android.gm': 'Gmail',
  'com.google.android.apps.maps': 'Google 地图',
  'com.google.android.apps.docs': 'Drive',
  'com.android.chrome': 'Chrome',
  'com.google.android.GoogleCamera': '相机',
  'com.android.settings': '设置',
  'com.google.android.gms': 'Google Play 服务',
  'com.android.systemui': '系统界面',
  'com.google.android.vending': 'Google Play 商店',
  'com.android.phone': '电话',
  'com.google.android.dialer': '拨号',
  'com.android.deskclock': '时钟',
  'com.google.android.apps.nexuslauncher': 'Pixel 启动器'
};

function appName(pkg) {
  const tail = String(pkg || '').split('.').pop() || pkg;
  return tail.replace(/(^|[._-])([a-z])/g, (_, prefix, char) => prefix + char.toUpperCase());
}

function displayName(app) {
  return app.label || KNOWN_LABELS[app.package] || appName(app.package);
}

function rowMarkup(app) {
  const hue = hashHue(app.package);
  const name = displayName(app);
  const frozen = Boolean(app.disabled);
  const primary = frozen
    ? '<button class="btn btn--ghost btn--sm" type="button" data-app-action="enable" title="解冻应用">' + icon('checkCircle') + '解冻</button>'
    : '<button class="btn btn--ghost btn--sm" type="button" data-app-action="launch" title="启动应用">' + icon('play') + '启动</button>';
  return '<div class="app-row' + (frozen ? ' app-row--frozen' : '') + '" data-package="' + esc(app.package) + '">' +
    '<span class="app-avatar ' + (app.icon ? 'app-avatar--image' : '') + '" style="--hue:' + hue + '">' + (app.icon ? '<img src="' + app.icon + '" alt="" loading="lazy">' : esc(initials(name))) + '</span>' +
    '<span class="app-name"><span class="app-name__line"><strong>' + esc(name) + '</strong>' + (frozen ? '<span class="app-badge">已冻结</span>' : '') + '</span><span>' + esc(app.package) + '</span></span>' +
    '<span class="app-path" title="' + esc(app.apkPath || '') + '">' + esc(app.apkPath || '—') + '</span>' +
    '<span class="app-row__actions">' +
      primary +
      '<button class="btn btn--ghost btn--sm" type="button" data-app-more title="更多操作">' + icon('dots') + '</button>' +
    '</span>' +
  '</div>';
}

function skeletonRows(count = 5) {
  let rows = '';
  for (let i = 0; i < count; i += 1) {
    rows += '<div class="app-row"><span class="skeleton" style="width:30px;height:30px;border-radius:9px"></span><span><span class="skeleton" style="display:block;width:' + (110 + i * 24) + 'px;height:9px"></span><span class="skeleton" style="display:block;width:' + (150 + i * 18) + 'px;height:7px;margin-top:5px"></span></span><span></span><span></span></div>';
  }
  return rows;
}

export async function mount(container) {
  let filter = (state.apps && state.apps.filter) || 'third';
  let search = '';
  let appsData = null;
  let loading = false;
  let error = '';
  let requestSeed = 0;
  let lastSerial = '';

  container.innerHTML =
    '<div class="page-head"><div class="page-head__copy"><div class="page-head__eyebrow">APPLICATION MANAGER</div><h1 class="page-title">应用<span>管理</span></h1><p class="page-subtitle" data-apps-subtitle>选择设备后读取已安装应用</p></div><div class="page-head__actions"><button class="btn btn--ghost" type="button" data-apps-refresh>' + icon('refresh') + '刷新</button><button class="btn btn--primary" type="button" data-apps-install>' + icon('upload') + '安装 APK</button></div></div>' +
    '<div class="app-toolbar glass"><div class="input-icon">' + icon('search') + '<input class="input" type="search" placeholder="搜索应用名或包名…" data-apps-search autocomplete="off" spellcheck="false"></div><div class="segmented" data-apps-filters>' + FILTERS.map((item) => '<button type="button" data-filter="' + item.id + '" class="' + (item.id === filter ? 'is-active' : '') + '">' + item.label + '</button>').join('') + '</div><span class="apps-count" data-apps-count>—</span></div>' +
    '<div class="apps-panel glass"><div class="apps-table-head"><span></span><span>应用</span><span>安装路径</span><span style="text-align:right">操作</span></div><div class="app-list-scroll" data-apps-list></div></div>';

  const listNode = container.querySelector('[data-apps-list]');
  const countNode = container.querySelector('[data-apps-count]');
  const subtitleNode = container.querySelector('[data-apps-subtitle]');
  const searchInput = container.querySelector('[data-apps-search]');
  const filterNode = container.querySelector('[data-apps-filters]');

  const currentDevice = () => selectedAdbDevice();

  const filtered = () => {
    const packages = (appsData && appsData.packages) || [];
    const q = search.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter((app) => app.package.toLowerCase().includes(q) || String(app.apkPath || '').toLowerCase().includes(q));
  };

  const renderSubtitle = () => {
    const device = currentDevice();
    if (state.demo) {
      subtitleNode.innerHTML = '演示数据 · <b>' + ((appsData && appsData.count) || 0) + '</b> 个应用 · ' + esc(device ? deviceName(device) : 'Pixel 8 Pro');
      return;
    }
    if (!device) {
      subtitleNode.textContent = '请先连接并选择一台 ADB 设备';
      return;
    }
    const suffix = filter === 'frozen' ? ' 个已冻结应用' : ' 个应用';
    subtitleNode.innerHTML = '设备 <b>' + esc(deviceName(device)) + '</b> · ' + ((appsData && appsData.count) || 0) + suffix;
  };

  const renderList = () => {
    if (loading) {
      listNode.innerHTML = skeletonRows();
      countNode.textContent = '读取中';
      return;
    }
    if (error) {
      listNode.innerHTML = '<div class="empty-state"><span class="empty-state__art">' + icon('alert') + '</span><strong>应用列表读取失败</strong><p>' + esc(error) + '</p><button class="btn btn--primary btn--sm" type="button" data-apps-refresh>重试</button></div>';
      countNode.textContent = '—';
      return;
    }
    if (!currentDevice() && !state.demo) {
      listNode.innerHTML = '<div class="empty-state"><span class="empty-state__art">' + icon('smartphone') + '</span><strong>等待设备</strong><p>应用管理需要一台已授权的在线 ADB 设备。</p></div>';
      countNode.textContent = '—';
      return;
    }
    const items = filtered();
    countNode.textContent = items.length + ' 个';
    if (!items.length) {
      const frozenEmpty = !search && filter === 'frozen';
      const title = search ? '没有匹配的应用' : frozenEmpty ? '没有被冻结的应用' : '这里还没有应用';
      const detail = search ? '尝试更换关键词或切换筛选条件。' : frozenEmpty ? '在应用右侧菜单中选择「冻结应用」后，会保留在这里方便随时解冻。' : '可以点击右上角安装 APK，或切换筛选范围。';
      listNode.innerHTML = '<div class="empty-state"><span class="empty-state__art">' + icon(frozenEmpty ? 'lock' : 'apps') + '</span><strong>' + title + '</strong><p>' + detail + '</p></div>';
      return;
    }
    listNode.innerHTML = items.map(rowMarkup).join('');
  };

  async function load(options = {}) {
    const seed = ++requestSeed;
    const device = currentDevice();
    if (state.demo) {
      appsData = demoApps(filter);
      loading = false;
      error = '';
      renderSubtitle();
      renderList();
      return;
    }
    if (!device) {
      appsData = null;
      loading = false;
      error = '';
      renderSubtitle();
      renderList();
      return;
    }
    if (device.state !== 'device') {
      appsData = null;
      loading = false;
      error = '设备当前状态为 ' + device.state + '，无法读取应用';
      renderSubtitle();
      renderList();
      return;
    }
    loading = true;
    error = '';
    renderList();
    try {
      const data = await api.apps.list(device.serial, filter, Boolean(options.refresh));
      if (seed !== requestSeed) return;
      appsData = data;
      loading = false;
      renderSubtitle();
      renderList();
      if (options.notify) toast('应用列表已更新', 'success', data.count + ' 个应用');
    } catch (err) {
      if (seed !== requestSeed) return;
      loading = false;
      error = err.message || '应用列表读取失败';
      appsData = null;
      renderSubtitle();
      renderList();
      if (!options.silent) toastError(err, '读取应用失败');
    }
  }

  async function runAppAction(pkg, action) {
    if (demoGuard()) return;
    const device = currentDevice();
    if (!device) {
      toast('请先选择设备', 'warn');
      return;
    }
    const labelMap = {
      launch: '启动应用',
      'force-stop': '强行停止',
      clear: '清除应用数据',
      uninstall: '卸载应用',
      disable: '冻结应用',
      enable: '解冻应用'
    };
    const label = labelMap[action] || '应用操作';
    if (action === 'clear') {
      const ok = await confirmModal({
        title: '清除应用数据',
        message: '将删除 ' + pkg + ' 的全部本地数据，但不会卸载应用。',
        confirmLabel: '清除数据',
        danger: true,
        icon: 'trash'
      });
      if (!ok) return;
    }
    if (action === 'uninstall') {
      const ok = await confirmModal({
        title: '卸载应用',
        message: '确定要从 ' + deviceName(device) + ' 卸载 ' + pkg + ' 吗？',
        confirmLabel: '卸载',
        danger: true,
        icon: 'trash'
      });
      if (!ok) return;
    }
    if (action === 'disable') {
      const ok = await confirmModal({
        title: '冻结应用',
        message: '冻结后应用会从启动器隐藏，数据仍然保留。之后可以在「已冻结」里随时解冻 ' + pkg + '。',
        confirmLabel: '冻结',
        icon: 'lock'
      });
      if (!ok) return;
    }
    try {
      const result = await api.apps.action(device.serial, pkg, action);
      const detail = result && result.output ? String(result.output).split(/\r?\n/).slice(-1)[0] : pkg;
      toast(label + '完成', 'success', detail);
      if (['uninstall', 'disable', 'enable'].includes(action)) setTimeout(() => load({ silent: true }), 450);
    } catch (err) {
      toastError(err, label + '失败');
    }
  }

  function openMore(pkg) {
    const app = (appsData && appsData.packages || []).find((item) => item.package === pkg);
    const frozen = Boolean(app && app.disabled);
    const actions = [
      { action: 'force-stop', icon: 'stop', title: '强行停止', detail: '结束应用后台进程' },
      { action: 'clear', icon: 'trash', title: '清除应用数据', detail: '删除应用本地数据，保留安装包' },
      frozen
        ? { action: 'enable', icon: 'checkCircle', title: '解冻应用', detail: '恢复到启动器，并解除冻结状态' }
        : { action: 'disable', icon: 'lock', title: '冻结应用', detail: '从启动器隐藏，可在「已冻结」中找回' },
      { action: 'uninstall', icon: 'unlink', title: '卸载应用', detail: '从设备上移除该应用', danger: true },
      { action: 'export', icon: 'download', title: '导出 base APK', detail: '保存到本地文件系统' }
    ];
    const modal = openModal({
      title: displayName(app || { package: pkg }),
      subtitle: pkg + (app ? ' · ' + (app.apkPath || '') : '') + (app && app.disabled ? ' · 已冻结' : ''),
      icon: 'apps',
      width: 540,
      content: '<div class="app-action-list">' + actions.map((item) => '<button class="app-action ' + (item.danger ? 'app-action--danger' : '') + '" type="button" data-more="' + item.action + '"><span class="app-action__icon">' + icon(item.icon) + '</span><span class="app-action__copy"><strong>' + item.title + '</strong><span>' + item.detail + '</span></span>' + icon('chevronRight') + '</button>').join('') + '</div>',
      footer: '<button class="btn btn--ghost" type="button" data-more-close>关闭</button>',
      onMount: ({ root, close }) => {
        root.querySelector('[data-more-close]').addEventListener('click', close);
        root.querySelectorAll('[data-more]').forEach((button) => {
          button.addEventListener('click', async () => {
            const action = button.dataset.more;
            close();
            if (action === 'export') {
              await exportApk(pkg);
              return;
            }
            await runAppAction(pkg, action);
          });
        });
      }
    });
    return modal;
  }

  async function exportApk(pkg) {
    if (demoGuard()) return;
    const device = currentDevice();
    if (!device) {
      toast('请先选择设备', 'warn');
      return;
    }
    runTaskModal({
      title: '导出 APK',
      subtitle: pkg + ' · 仅导出 base APK',
      icon: 'download',
      consoleTitle: 'sakura-export',
      start: (handlers) => exportApp(device.serial, pkg, handlers),
      successMessage: 'APK 已导出'
    });
  }

  async function installFlow() {
    if (demoGuard()) return;
    const device = currentDevice();
    if (!device) {
      toast('请先连接并选择设备', 'warn');
      return;
    }
    if (device.state !== 'device') {
      toast('设备当前不可安装应用', 'warn', '设备状态：' + device.state);
      return;
    }
    try {
      const file = await api.files.pick('apk');
      if (!file) return;
      runTaskModal({
        title: '安装 APK',
        subtitle: file.name,
        icon: 'upload',
        consoleTitle: 'sakura-install',
        start: (handlers) => installApk(device.serial, file.token, handlers),
        successMessage: '应用安装完成',
        onComplete: () => load({ silent: true })
      });
    } catch (err) {
      toastError(err);
    }
  }

  const onClick = async (event) => {
    if (event.target.closest('[data-apps-refresh]')) {
      await load({ notify: true, refresh: true });
      return;
    }
    if (event.target.closest('[data-apps-install]')) {
      await installFlow();
      return;
    }
    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) {
      filter = filterButton.dataset.filter;
      filterNode.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('is-active', button === filterButton));
      await load({ silent: true });
      return;
    }
    const actionButton = event.target.closest('[data-app-action]');
    if (actionButton) {
      const row = actionButton.closest('[data-package]');
      await runAppAction(row.dataset.package, actionButton.dataset.appAction);
      return;
    }
    if (event.target.closest('[data-app-more]')) {
      const row = event.target.closest('[data-package]');
      openMore(row.dataset.package);
    }
  };

  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    renderList();
  });

  container.addEventListener('click', onClick);

  const unsubscribe = subscribe(() => {
    const serial = state.activeAdbSerial;
    renderSubtitle();
    if (serial !== lastSerial) {
      lastSerial = serial;
      load({ silent: true });
    }
  });
  lastSerial = state.activeAdbSerial;
  renderSubtitle();
  await load({ silent: true });

  return () => {
    unsubscribe();
    container.removeEventListener('click', onClick);
  };
}