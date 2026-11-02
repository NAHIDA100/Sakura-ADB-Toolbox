import { icon } from '../icons.js';
import { api, startWipe } from '../api.js';
import { state, subscribe, selectedFastbootDevice, selectedAdbDevice } from '../store.js';
import { esc, formatDuration, deviceName } from '../dom.js';
import { toast, toastError } from '../components/toast.js';
import { confirmModal } from '../components/modal.js';
import { demoGuard, refreshDevices } from '../actions.js';

function consoleLine(text, type = '') {
  const line = document.createElement('div');
  line.className = 'task-line' + (type ? ' task-line--' + type : '');
  line.textContent = text;
  return line;
}

export async function mount(container) {
  const options = { data: true, cache: true, reboot: false };
  let running = false;
  let fastbootTimer = null;
  let completed = false;

  container.innerHTML =
    '<div class="page-head"><div class="page-head__copy"><div class="page-head__eyebrow">DESTRUCTIVE OPERATIONS</div><h1 class="page-title">双清<span>操作</span></h1><p class="page-subtitle">清除用户数据与缓存分区。操作不可撤销，请务必确认设备、备份重要数据并保持供电。</p></div><div class="page-head__actions"><button class="btn btn--ghost" type="button" data-wipe-refresh>' + icon('refresh') + '刷新设备</button><button class="btn btn--ghost" type="button" data-wipe-enter-fastboot>' + icon('flash') + '进入 Fastboot</button></div></div>' +
    '<div class="operate-grid">' +
      '<div>' +
        '<section class="form-panel glass danger-panel">' +
          '<div class="form-section"><div class="form-section__head"><span class="form-section__num">01</span><span class="form-section__title">确认 Fastboot 设备</span></div><div data-wipe-state></div></div>' +
          '<div class="form-section"><div class="form-section__head"><span class="form-section__num">02</span><span class="form-section__title">选择清除范围</span></div><div class="wipe-options">' +
            '<label class="check-card is-checked" data-option-card="data"><input type="checkbox" data-option="data" checked><span class="check-card__copy"><strong>清除用户数据</strong><span>执行 fastboot -w，删除用户数据与元数据，相当于恢复出厂设置。</span></span></label>' +
            '<label class="check-card is-checked" data-option-card="cache"><input type="checkbox" data-option="cache" checked><span class="check-card__copy"><strong>清除缓存分区</strong><span>执行 fastboot erase cache；没有独立 cache 分区的设备会自动跳过。</span></span></label>' +
            '<label class="check-card" data-option-card="reboot"><input type="checkbox" data-option="reboot"><span class="check-card__copy"><strong>完成后重启系统</strong><span>双清结束后执行 fastboot reboot，首次开机可能较慢。</span></span></label>' +
          '</div></div>' +
          '<div class="form-section"><div class="form-section__head"><span class="form-section__num">03</span><span class="form-section__title">危险确认</span></div><div class="callout callout--danger">' + icon('alert') + '<div>照片、聊天记录、应用与内部存储都会被删除，且无法恢复。请先备份。</div></div><div class="confirm-word">确认短语：<code>双清</code></div><button class="btn btn--danger btn--wide" type="button" data-wipe-start style="margin-top:11px">' + icon('trash') + '执行双清</button></div>' +
        '</section>' +
      '</div>' +
      '<div class="operate-side"><div class="task-console">' +
        '<div class="task-console__head"><span class="task-console__lights"><i></i><i></i><i></i></span><span class="task-console__title">sakura-wipe</span><span class="task-console__status" data-wipe-status>等待操作</span></div>' +
        '<div class="task-console__body" data-wipe-log><div class="task-console__empty">' + icon('trash') + '<span>双清过程会显示在这里</span><span>执行前会再次校验确认短语</span></div></div>' +
      '</div></div>' +
    '</div>';

  const stateNode = container.querySelector('[data-wipe-state]');
  const logNode = container.querySelector('[data-wipe-log]');
  const statusNode = container.querySelector('[data-wipe-status]');
  const startButton = container.querySelector('[data-wipe-start]');

  function setStatus(text, color = '') {
    statusNode.textContent = text;
    statusNode.style.color = color;
  }

  function append(text, type = '') {
    const empty = logNode.querySelector('.task-console__empty');
    if (empty) logNode.innerHTML = '';
    logNode.appendChild(consoleLine(text, type));
    while (logNode.children.length > 600) logNode.firstElementChild.remove();
    logNode.scrollTop = logNode.scrollHeight;
  }

  function renderState() {
    const fastboot = selectedFastbootDevice();
    const adb = selectedAdbDevice();
    if (fastboot) {
      stateNode.innerHTML = '<div class="fastboot-state"><span class="status-dot status-dot--fastboot status-dot--pulse"></span><strong>' + esc(fastboot.serial) + '</strong><span class="badge badge--blue"><span class="badge__dot"></span>Fastboot</span></div>';
    } else {
      stateNode.innerHTML = '<div class="fastboot-state"><span class="status-dot status-dot--offline"></span><strong>未检测到 Fastboot 设备</strong><span class="badge badge--amber">' + (adb ? 'ADB 设备已连接' : '等待设备') + '</span></div><div class="callout callout--warn" style="margin-top:8px">' + icon('info') + '<div>' + (adb ? '请先点击“进入 Fastboot”，双清只能在 Bootloader 中执行。' : '连接设备并进入 Bootloader 后再进行双清。') + '</div></div>';
    }
    startButton.disabled = running || !fastboot;
  }

  function setRunning(value) {
    running = value;
    startButton.disabled = value;
    startButton.innerHTML = value ? '<span class="spinner" style="border-color:rgba(255,255,255,.35);border-top-color:#fff"></span>执行中…' : icon('trash') + '执行双清';
    if (value) setStatus('执行中');
  }

  async function enterFastboot() {
    if (demoGuard()) return;
    const adb = selectedAdbDevice();
    if (!adb) {
      toast('没有可用的 ADB 设备', 'warn');
      return;
    }
    const ok = await confirmModal({ title: '进入 Fastboot', message: '将向 ' + deviceName(adb) + ' 发送重启到 Bootloader 的指令。', confirmLabel: '继续', danger: true, icon: 'flash' });
    if (!ok) return;
    try {
      await api.devices.action(adb.serial, 'bootloader');
      toast('已发送进入 Fastboot 指令', 'success');
      let attempts = 0;
      if (fastbootTimer) clearInterval(fastbootTimer);
      fastbootTimer = setInterval(async () => {
        attempts += 1;
        const snapshot = await refreshDevices({ silent: true });
        if (snapshot && snapshot.fastboot && snapshot.fastboot.some((item) => item.serial === adb.serial)) {
          clearInterval(fastbootTimer);
          fastbootTimer = null;
          toast('设备已进入 Fastboot', 'success');
        }
        if (attempts >= 40 && fastbootTimer) {
          clearInterval(fastbootTimer);
          fastbootTimer = null;
        }
      }, 1500);
    } catch (error) {
      toastError(error);
    }
  }

  async function start() {
    const fastboot = selectedFastbootDevice();
    if (!fastboot) {
      toast('当前没有 Fastboot 设备', 'warn');
      return;
    }
    if (!options.data && !options.cache) {
      toast('至少选择一项清除范围', 'warn');
      return;
    }
    const commands = [];
    if (options.data) commands.push('fastboot -s ' + fastboot.serial + ' -w');
    if (options.cache) commands.push('fastboot -s ' + fastboot.serial + ' erase cache');
    if (options.reboot) commands.push('fastboot -s ' + fastboot.serial + ' reboot');
    const confirmed = await confirmModal({
      title: '确认执行双清',
      subtitle: '此操作不可撤销',
      icon: 'trash',
      danger: true,
      requireText: '双清',
      confirmLabel: '确认双清',
      bodyHtml:
        '<div class="callout callout--danger">' + icon('alert') + '<div>即将清除 ' + esc(fastboot.serial) + ' 的用户数据和缓存。照片、应用与内部存储将永久删除。</div></div>' +
        '<div class="field" style="margin-top:12px"><span class="field__label">将执行</span><div class="code-block">' + commands.map(esc).join('<br>') + '</div></div>'
    });
    if (!confirmed) return;
    if (demoGuard()) return;

    completed = false;
    setRunning(true);
    logNode.innerHTML = '';
    setStatus('执行中');
    append('◆ 开始双清 · ' + fastboot.serial, 'stage');
    const task = startWipe({ serial: fastboot.serial, data: options.data, cache: options.cache, reboot: options.reboot, confirm: '双清' }, {
      onStarted: (data) => { if (data) append('任务已启动：' + data.serial, 'muted'); },
      onStage: (label) => { append('◆ ' + label, 'stage'); setStatus('执行中'); },
      onLine: (line, stream) => append(line, stream === 'stderr' ? 'stderr' : ''),
      onError: (event) => { append('错误：' + (event && event.message ? event.message : '双清失败'), 'stderr'); setStatus('失败', '#ff9eb4'); },
      onDone: async (result, error) => {
        completed = true;
        if (error) {
          setStatus('失败', '#ff9eb4');
          toast(error.message || '双清失败', 'error', error.detail || '');
        } else {
          setStatus('已完成 · ' + formatDuration(result.durationMs), '#6be0b3');
          append('✓ 双清完成，用时 ' + formatDuration(result.durationMs), 'success');
          toast('双清操作完成', 'success', '设备将保持当前模式或按设置重启');
        }
        setRunning(false);
        renderState();
        await refreshDevices({ silent: true });
      }
    });
    task.promise.catch((error) => {
      if (!completed) {
        completed = true;
        setStatus('失败', '#ff9eb4');
        toastError(error, '双清失败');
        setRunning(false);
        renderState();
      }
    });
  }

  container.querySelectorAll('[data-option]').forEach((input) => {
    input.addEventListener('change', () => {
      options[input.dataset.option] = input.checked;
      const card = container.querySelector('[data-option-card="' + input.dataset.option + '"]');
      if (card) card.classList.toggle('is-checked', input.checked);
      startButton.disabled = running || !selectedFastbootDevice() || (!options.data && !options.cache);
    });
  });

  const onClick = async (event) => {
    if (event.target.closest('[data-wipe-refresh]')) {
      await refreshDevices({ manual: true });
      toast('设备列表已刷新', 'info');
      return;
    }
    if (event.target.closest('[data-wipe-enter-fastboot]')) {
      await enterFastboot();
      return;
    }
    if (event.target.closest('[data-wipe-start]')) {
      await start();
    }
  };

  container.addEventListener('click', onClick);
  renderState();
  const unsubscribe = subscribe(() => {
    renderState();
  });

  return () => {
    unsubscribe();
    container.removeEventListener('click', onClick);
    if (fastbootTimer) clearInterval(fastbootTimer);
  };
}
