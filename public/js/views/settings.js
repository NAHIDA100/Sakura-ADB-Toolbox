import { icon } from '../icons.js';
import { api } from '../api.js';
import { state, subscribe, update } from '../store.js';
import { esc } from '../dom.js';
import { toast, toastError } from '../components/toast.js';
import { demoGuard, refreshDevices } from '../actions.js';

function statusBadge(found, label) {
  return '<span class="badge ' + (found ? 'badge--mint' : 'badge--danger') + '"><span class="badge__dot"></span>' + (found ? label || '已检测' : '未找到') + '</span>';
}

export async function mount(container) {
  let appInfo = null;
  container.innerHTML =
    '<div class="page-head"><div class="page-head__copy"><div class="page-head__eyebrow">PREFERENCES</div><h1 class="page-title">系统<span>设置</span></h1><p class="page-subtitle">配置 Android platform-tools 路径，查看运行环境与应用信息。</p></div></div>' +
    '<div class="settings-grid">' +
      '<section class="settings-panel glass">' +
        '<h2>' + icon('plug') + '工具路径</h2><p class="settings-lead">应用优先自动检测本机 ADB。也可以手动指定 adb.exe 与 fastboot.exe，或它们所在的 platform-tools 目录。</p>' +
        '<div class="path-field"><label class="field__label" for="setting-adb">ADB 可执行文件 <span data-adb-status>' + statusBadge(false, '检测中') + '</span></label><input class="input" id="setting-adb" data-adb-path placeholder="自动检测：D:\\Android\\Sdk\\platform-tools\\adb.exe" spellcheck="false"><div class="path-actions"><button class="btn btn--ghost" type="button" data-browse-adb>' + icon('folderOpen') + '浏览</button><button class="btn btn--ghost" type="button" data-detect>' + icon('search') + '重新检测</button></div></div>' +
        '<div class="path-field"><label class="field__label" for="setting-fastboot">Fastboot 可执行文件 <span data-fastboot-status>' + statusBadge(false, '检测中') + '</span></label><input class="input" id="setting-fastboot" data-fastboot-path placeholder="自动检测：D:\\Android\\Sdk\\platform-tools\\fastboot.exe" spellcheck="false"><div class="path-actions"><button class="btn btn--ghost" type="button" data-browse-fastboot>' + icon('folderOpen') + '浏览</button></div></div>' +
        '<div class="divider"></div>' +
        '<label class="check-card" data-motion-card><input type="checkbox" data-reduced-motion><span class="check-card__copy"><strong>减少动效</strong><span>关闭背景漂浮与大部分过渡动画，适合低性能设备。</span></span></label>' +
        '<div class="settings-actions"><button class="btn btn--primary" type="button" data-save-settings>' + icon('save') + '保存设置</button><button class="btn btn--ghost" type="button" data-open-data>' + icon('folder') + '打开数据目录</button></div>' +
      '</section>' +
      '<section class="settings-panel glass">' +
        '<div class="about-brand"><span class="about-brand__mark" style="display:grid;place-items:center;background:linear-gradient(140deg,#ff8db7,#ff4f8f 56%,#ad7cf1);color:#fff">' + icon('sparkles') + '</span><div><strong>Sakura ADB Toolbox</strong><span>Liquid Glass · Device Studio</span></div></div>' +
        '<div class="about-meta"><div><span>版本</span><b data-version>—</b></div><div><span>平台</span><b data-platform>Windows x64</b></div><div><span>Electron</span><b data-electron>—</b></div><div><span>Chrome</span><b data-chrome>—</b></div></div>' +
        '<div class="divider"></div>' +
        '<h2>' + icon('activity') + '运行状态</h2><div class="status-list" data-status-list></div>' +
        '<div class="divider"></div>' +
        '<div class="callout">' + icon('shield') + '<div>所有 ADB/Fastboot 命令均以参数数组启动，不经过 shell；应用只监听本机回环数据，不上传设备信息。</div></div>' +
        '<div class="callout callout--warn" style="margin-top:8px">' + icon('alert') + '<div>刷写与双清具有设备风险，请确保 Bootloader 已解锁并已备份数据。</div></div>' +
      '</section>' +
    '</div>';

  const adbInput = container.querySelector('[data-adb-path]');
  const fastbootInput = container.querySelector('[data-fastboot-path]');
  const adbStatus = container.querySelector('[data-adb-status]');
  const fastbootStatus = container.querySelector('[data-fastboot-status]');
  const motionInput = container.querySelector('[data-reduced-motion]');
  const motionCard = container.querySelector('[data-motion-card]');
  const statusList = container.querySelector('[data-status-list]');

  const settings = state.settings || {};
  adbInput.value = settings.adbPath || '';
  fastbootInput.value = settings.fastbootPath || '';
  motionInput.checked = Boolean(settings.reducedMotion);
  motionCard.classList.toggle('is-checked', motionInput.checked);

  const renderStatus = () => {
    const health = state.health;
    const tools = state.tools || (health && health.tools) || {};
    const adb = health && health.adb;
    const fastboot = health && health.fastboot;
    adbStatus.innerHTML = statusBadge(Boolean(tools.adbFound || (adb && adb.found)), tools.adbFound ? '已检测' : '未找到');
    fastbootStatus.innerHTML = statusBadge(Boolean(tools.fastbootFound || (fastboot && fastboot.found)), tools.fastbootFound ? '已检测' : '未找到');
    if (!adbInput.value && tools.adbPath) adbInput.placeholder = '自动检测：' + tools.adbPath;
    if (!fastbootInput.value && tools.fastbootPath) fastbootInput.placeholder = '自动检测：' + tools.fastbootPath;
    statusList.innerHTML =
      '<div class="status-row"><span class="status-dot status-dot--' + (adb && adb.found ? 'online' : 'warn') + '"></span><span>ADB</span><b>' + esc((adb && adb.version) || (tools.adbPath ? '已找到可执行文件' : '未配置')) + '</b></div>' +
      '<div class="status-row"><span class="status-dot status-dot--' + (fastboot && fastboot.found ? 'online' : 'warn') + '"></span><span>Fastboot</span><b>' + esc((fastboot && fastboot.version) || (tools.fastbootPath ? '已找到可执行文件' : '未配置')) + '</b></div>' +
      '<div class="status-row"><span class="status-dot status-dot--fastboot"></span><span>ADB 设备</span><b>' + (state.devices.adb || []).length + ' 台</b></div>' +
      '<div class="status-row"><span class="status-dot status-dot--fastboot"></span><span>Fastboot 设备</span><b>' + (state.devices.fastboot || []).length + ' 台</b></div>' +
      '<div class="status-row"><span class="status-dot status-dot--offline"></span><span>数据目录</span><b title="' + esc((health && health.dataDir) || '') + '">' + esc((health && health.dataDir) || '—') + '</b></div>';
    container.querySelector('[data-version]').textContent = 'v' + ((health && health.appVersion) || '1.0.0');
    container.querySelector('[data-platform]').textContent = ((health && health.platform) || 'win32') + ' / ' + ((health && health.arch) || 'x64');
    container.querySelector('[data-electron]').textContent = appInfo ? appInfo.electron : '—';
    container.querySelector('[data-chrome]').textContent = appInfo ? appInfo.chrome : '—';
  };

  const refreshHealth = async () => {
    try {
      const health = await api.system.health();
      update({ health, tools: health.tools, settings: state.settings });
      renderStatus();
    } catch (error) {
      toastError(error, '读取环境信息失败');
    }
  };

  const browse = async (kind) => {
    if (demoGuard()) return;
    try {
      const filePath = kind === 'adb' ? await api.settings.browseAdb() : await api.settings.browseFastboot();
      if (!filePath) return;
      if (kind === 'adb') adbInput.value = filePath;
      else fastbootInput.value = filePath;
    } catch (error) {
      toastError(error);
    }
  };

  const detect = async () => {
    if (demoGuard()) return;
    try {
      const result = await api.settings.detect();
      update({ tools: result.tools });
      renderStatus();
      toast('自动检测完成', result.tools.adbFound ? 'success' : 'warn', result.tools.adbFound ? '已找到 ADB' : '未找到 ADB，请手动指定路径');
    } catch (error) {
      toastError(error);
    }
  };

  const save = async () => {
    if (demoGuard()) return;
    const button = container.querySelector('[data-save-settings]');
    button.classList.add('is-loading');
    try {
      const result = await api.settings.save({
        adbPath: adbInput.value.trim(),
        fastbootPath: fastbootInput.value.trim(),
        reducedMotion: motionInput.checked
      });
      update({ settings: result.settings, tools: result.tools });
      document.documentElement.classList.toggle('reduced-motion', Boolean(result.settings.reducedMotion));
      await refreshHealth();
      toast('设置已保存', 'success');
    } catch (error) {
      toastError(error, '保存设置失败');
    } finally {
      button.classList.remove('is-loading');
    }
  };

  const onClick = async (event) => {
    if (event.target.closest('[data-browse-adb]')) return browse('adb');
    if (event.target.closest('[data-browse-fastboot]')) return browse('fastboot');
    if (event.target.closest('[data-detect]')) return detect();
    if (event.target.closest('[data-save-settings]')) return save();
    if (event.target.closest('[data-open-data]')) {
      if (demoGuard()) return;
      try {
        await api.system.openDataDir();
      } catch (error) {
        toastError(error);
      }
    }
  };

  motionInput.addEventListener('change', () => {
    motionCard.classList.toggle('is-checked', motionInput.checked);
    document.documentElement.classList.toggle('reduced-motion', motionInput.checked);
  });

  container.addEventListener('click', onClick);
  const unsubscribe = subscribe(renderStatus);
  renderStatus();
  try { appInfo = await api.system.appInfo(); } catch { appInfo = null; }
  renderStatus();

  return () => {
    unsubscribe();
    container.removeEventListener('click', onClick);
  };
}
