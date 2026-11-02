import { icon } from '../icons.js';
import { api, startFlash } from '../api.js';
import { state, subscribe, selectedFastbootDevice, selectedAdbDevice } from '../store.js';
import { esc, formatBytes, formatDuration, deviceName, statusMeta } from '../dom.js';
import { toast, toastError } from '../components/toast.js';
import { confirmModal } from '../components/modal.js';
import { demoGuard, refreshDevices } from '../actions.js';

const PARTITIONS = ['boot', 'init_boot', 'recovery', 'vbmeta', 'vendor_boot', 'dtbo'];

function consoleLine(text, type = '') {
  const line = document.createElement('div');
  line.className = 'task-line' + (type ? ' task-line--' + type : '');
  line.textContent = text;
  return line;
}

export async function mount(container) {
  let selectedFile = null;
  let partition = 'boot';
  let running = false;
  let fastbootTimer = null;
  let completed = false;

  container.innerHTML =
    '<div class="page-head"><div class="page-head__copy"><div class="page-head__eyebrow">FASTBOOT WORKBENCH</div><h1 class="page-title">Fastboot <span>刷写</span></h1><p class="page-subtitle">将镜像写入指定分区。开始前请确认设备已进入 Bootloader，并已解锁 Bootloader。</p></div><div class="page-head__actions"><button class="btn btn--ghost" type="button" data-flash-refresh>' + icon('refresh') + '刷新设备</button><button class="btn btn--primary" type="button" data-enter-fastboot>' + icon('flash') + '进入 Fastboot</button></div></div>' +
    '<div class="operate-grid">' +
      '<div>' +
        '<section class="form-panel glass">' +
          '<div class="form-section"><div class="form-section__head"><span class="form-section__num">01</span><span class="form-section__title">确认 Fastboot 设备</span></div><div data-fastboot-state></div></div>' +
          '<div class="form-section"><div class="form-section__head"><span class="form-section__num">02</span><span class="form-section__title">选择镜像文件</span></div><div data-file-picker></div><div class="field__hint" style="margin-top:6px">支持 .img / .bin，大小上限 4GB。文件只会通过主进程读取，不会上传到网络。</div></div>' +
          '<div class="form-section"><div class="form-section__head"><span class="form-section__num">03</span><span class="form-section__title">选择目标分区</span></div><div class="partition-grid" data-partitions>' + PARTITIONS.map((name) => '<button class="partition-chip ' + (name === 'boot' ? 'is-active' : '') + '" type="button" data-partition="' + name + '">' + name + '</button>').join('') + '</div><div class="field" style="margin-top:8px"><label class="field__label" for="custom-partition">自定义分区</label><input class="input mono" id="custom-partition" data-custom-partition placeholder="例如 vendor_boot" autocomplete="off" spellcheck="false"></div></div>' +
          '<div class="form-section"><div class="form-section__head"><span class="form-section__num">04</span><span class="form-section__title">确认并刷写</span></div><label class="check-card" data-reboot-card><input type="checkbox" data-flash-reboot><span class="check-card__copy"><strong>刷写完成后重启设备</strong><span>执行 fastboot reboot，让设备离开 Bootloader。</span></span></label><div class="callout callout--danger" style="margin-top:9px">' + icon('alert') + '<div>刷错分区可能导致设备无法启动。请核对设备代号、分区和镜像来源，并确保电量充足。</div></div><div class="confirm-word">确认短语：<code>FLASH</code></div><button class="btn btn--danger btn--wide" type="button" data-flash-start style="margin-top:11px">' + icon('flash') + '开始刷写</button></div>' +
        '</section>' +
      '</div>' +
      '<div class="operate-side"><div class="task-console" data-flash-console>' +
        '<div class="task-console__head"><span class="task-console__lights"><i></i><i></i><i></i></span><span class="task-console__title">sakura-fastboot</span><span class="task-console__status" data-flash-status>等待操作</span></div>' +
        '<div class="task-console__body" data-flash-log><div class="task-console__empty">' + icon('terminal') + '<span>刷写日志和进度会显示在这里</span><span>命令不会经过 shell 拼接</span></div></div>' +
      '</div></div>' +
    '</div>';

  const fastbootStateNode = container.querySelector('[data-fastboot-state]');
  const pickerNode = container.querySelector('[data-file-picker]');
  const partitionsNode = container.querySelector('[data-partitions]');
  const customInput = container.querySelector('[data-custom-partition]');
  const logNode = container.querySelector('[data-flash-log]');
  const statusNode = container.querySelector('[data-flash-status]');
  const startButton = container.querySelector('[data-flash-start]');
  const rebootCheckbox = container.querySelector('[data-flash-reboot]');
  const rebootCard = container.querySelector('[data-reboot-card]');

  function setStatus(text, color = '') {
    if (!statusNode) return;
    statusNode.textContent = text;
    statusNode.style.color = color;
  }

  function append(text, type = '') {
    if (!logNode || !text) return;
    const empty = logNode.querySelector('.task-console__empty');
    if (empty) logNode.innerHTML = '';
    logNode.appendChild(consoleLine(text, type));
    while (logNode.children.length > 600) logNode.firstElementChild.remove();
    logNode.scrollTop = logNode.scrollHeight;
  }

  function clearConsole() {
    logNode.innerHTML = '<div class="task-console__empty">' + icon('terminal') + '<span>刷写日志和进度会显示在这里</span><span>命令不会经过 shell 拼接</span></div>';
    setStatus('等待操作');
  }

  function renderFastboot() {
    const fastboot = selectedFastbootDevice();
    const adb = selectedAdbDevice();
    if (fastboot) {
      fastbootStateNode.innerHTML = '<div class="fastboot-state"><span class="status-dot status-dot--fastboot status-dot--pulse"></span><strong>' + esc(fastboot.serial) + '</strong><span class="badge badge--blue"><span class="badge__dot"></span>Fastboot</span></div>';
    } else {
      fastbootStateNode.innerHTML = '<div class="fastboot-state"><span class="status-dot status-dot--offline"></span><strong>未检测到 Fastboot 设备</strong><span class="badge badge--amber">' + (adb ? 'ADB 设备已连接' : '等待设备') + '</span></div>' +
        '<div class="callout callout--warn" style="margin-top:8px">' + icon('info') + '<div>' + (adb ? '点击右上角“进入 Fastboot”，设备会重启到 Bootloader。' : '请先通过 USB 连接设备，或在终端确认设备状态。') + '</div></div>';
    }
  }

  function renderFile() {
    if (!selectedFile) {
      pickerNode.innerHTML = '<div class="file-drop"><span class="file-drop__icon">' + icon('file') + '</span><div class="file-drop__copy"><strong>尚未选择镜像</strong><span>选择一个 boot、recovery 或其它分区镜像</span></div><button class="btn btn--ghost btn--sm file-drop__action" type="button" data-pick-image>' + icon('folderOpen') + '选择</button></div>';
      return;
    }
    pickerNode.innerHTML = '<div class="file-drop is-ready"><span class="file-drop__icon" style="color:var(--mint)">' + icon('checkCircle') + '</span><div class="file-drop__copy"><strong>' + esc(selectedFile.name) + '</strong><span>' + formatBytes(selectedFile.size) + (selectedFile.sha256 ? ' · SHA-256 ' + esc(selectedFile.sha256.slice(0, 16)) + '…' : '') + '</span></div><button class="btn btn--ghost btn--sm file-drop__action" type="button" data-pick-image>重新选择</button></div>';
  }

  function renderPartitions() {
    partitionsNode.querySelectorAll('[data-partition]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.partition === partition);
    });
  }

  function setRunning(value) {
    running = value;
    startButton.disabled = value;
    startButton.innerHTML = value ? '<span class="spinner" style="border-color:rgba(255,255,255,.35);border-top-color:#fff"></span>正在刷写…' : icon('flash') + '开始刷写';
    if (value) setStatus('执行中');
  }

  function resetAfterTask() {
    running = false;
    startButton.disabled = false;
    startButton.innerHTML = icon('flash') + '开始刷写';
    renderFile();
    renderFastboot();
  }

  async function pickImage() {
    if (demoGuard()) return;
    try {
      const file = await api.files.pick('image');
      if (!file) return;
      selectedFile = file;
      renderFile();
      setStatus('镜像已就绪', '#8be4c2');
      append('镜像已选择：' + file.name, 'muted');
      append('大小：' + formatBytes(file.size) + ' · SHA-256：' + file.sha256, 'muted');
    } catch (error) {
      toastError(error, '选择镜像失败');
    }
  }

  async function enterFastboot() {
    if (demoGuard()) return;
    const adb = selectedAdbDevice();
    if (!adb) {
      toast('没有可用的 ADB 设备', 'warn', '请先连接设备');
      return;
    }
    const confirmed = await confirmModal({
      title: '进入 Fastboot',
      message: '将向 ' + deviceName(adb) + ' 发送重启到 Bootloader 的指令。',
      confirmLabel: '进入 Fastboot',
      icon: 'flash',
      danger: true
    });
    if (!confirmed) return;
    try {
      await api.devices.action(adb.serial, 'bootloader');
      toast('已发送进入 Fastboot 指令', 'success', '正在轮询设备');
      let attempts = 0;
      if (fastbootTimer) clearInterval(fastbootTimer);
      fastbootTimer = setInterval(async () => {
        attempts += 1;
        const snapshot = await refreshDevices({ silent: true });
        if (snapshot && snapshot.fastboot && snapshot.fastboot.some((item) => item.serial === adb.serial)) {
          clearInterval(fastbootTimer);
          fastbootTimer = null;
          toast('设备已进入 Fastboot', 'success', adb.serial);
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
      toast('当前没有 Fastboot 设备', 'warn', '请先进入 Bootloader');
      return;
    }
    if (!selectedFile) {
      toast('请先选择镜像文件', 'warn');
      return;
    }
    if (!partition) {
      toast('请选择或输入目标分区', 'warn');
      return;
    }
    const confirmed = await confirmModal({
      title: '确认刷写镜像',
      subtitle: '此操作会写入设备分区',
      icon: 'flash',
      danger: true,
      requireText: 'FLASH',
      confirmLabel: '确认刷写',
      bodyHtml:
        '<div class="callout callout--danger">' + icon('alert') + '<div>刷写前请再次核对分区与镜像，错误的分区可能导致设备无法启动。</div></div>' +
        '<div class="field" style="margin-top:12px"><span class="field__label">目标设备</span><div class="code-block">' + esc(fastboot.serial) + '</div></div>' +
        '<div class="form-grid" style="margin-top:9px"><div class="field"><span class="field__label">分区</span><div class="code-block">' + esc(partition) + '</div></div><div class="field"><span class="field__label">镜像</span><div class="code-block" title="' + esc(selectedFile.name) + '">' + esc(selectedFile.name) + '</div></div></div>' +
        '<div class="field" style="margin-top:9px"><span class="field__label">SHA-256</span><div class="code-block">' + esc(selectedFile.sha256 || '—') + '</div></div>' +
        '<div class="field" style="margin-top:9px"><span class="field__label">将执行</span><div class="code-block">fastboot -s ' + esc(fastboot.serial) + ' flash ' + esc(partition) + ' &lt;selected-image&gt;</div></div>'
    });
    if (!confirmed) return;
    if (demoGuard()) return;

    completed = false;
    setRunning(true);
    logNode.innerHTML = '';
    setStatus('执行中');
    append('◆ 开始刷写 ' + partition + ' · ' + fastboot.serial, 'stage');
    append('镜像：' + selectedFile.name + ' · ' + formatBytes(selectedFile.size), 'muted');
    const token = selectedFile.token;
    const reboot = rebootCheckbox.checked;
    const task = startFlash({ serial: fastboot.serial, partition, token, confirm: 'FLASH', reboot }, {
      onStarted: (data) => {
        if (data && data.file) append('服务端已锁定镜像：' + data.file.name, 'muted');
      },
      onStage: (label) => {
        append('◆ ' + label, 'stage');
        setStatus('执行中');
      },
      onLine: (line, stream) => append(line, stream === 'stderr' ? 'stderr' : ''),
      onError: (event) => {
        append('错误：' + (event && event.message ? event.message : '刷写失败'), 'stderr');
        setStatus('失败', '#ff9eb4');
      },
      onDone: async (result, error) => {
        completed = true;
        if (error) {
          setStatus('失败', '#ff9eb4');
          toast(error.message || '刷写失败', 'error', error.detail || '');
        } else {
          setStatus('已完成 · ' + formatDuration(result.durationMs), '#6be0b3');
          append('✓ 刷写完成，用时 ' + formatDuration(result.durationMs), 'success');
          toast('镜像刷写完成', 'success', partition + ' · ' + formatBytes(selectedFile ? selectedFile.size : 0));
          selectedFile = null;
          partition = 'boot';
          customInput.value = '';
          renderPartitions();
        }
        resetAfterTask();
        await refreshDevices({ silent: true });
        renderFastboot();
      }
    });
    task.promise.catch((error) => {
      if (!completed) {
        completed = true;
        setStatus('失败', '#ff9eb4');
        toastError(error, '刷写失败');
        resetAfterTask();
      }
    });
  }

  const onClick = async (event) => {
    if (event.target.closest('[data-pick-image]')) {
      await pickImage();
      return;
    }
    if (event.target.closest('[data-enter-fastboot]')) {
      await enterFastboot();
      return;
    }
    if (event.target.closest('[data-flash-refresh]')) {
      await refreshDevices({ manual: true });
      toast('设备列表已刷新', 'info');
      return;
    }
    const part = event.target.closest('[data-partition]');
    if (part) {
      partition = part.dataset.partition;
      customInput.value = '';
      renderPartitions();
      return;
    }
    if (event.target.closest('[data-flash-start]')) {
      await start();
    }
  };

  container.addEventListener('click', onClick);

  customInput.addEventListener('input', () => {
    partition = customInput.value.trim();
    partitionsNode.querySelectorAll('[data-partition]').forEach((button) => button.classList.remove('is-active'));
  });

  rebootCheckbox.addEventListener('change', () => {
    rebootCard.classList.toggle('is-checked', rebootCheckbox.checked);
  });

  renderFastboot();
  renderFile();
  renderPartitions();
  const unsubscribe = subscribe(() => {
    renderFastboot();
    if (!running) startButton.disabled = !selectedFastbootDevice() || !selectedFile;
  });

  return () => {
    unsubscribe();
    container.removeEventListener('click', onClick);
    if (fastbootTimer) clearInterval(fastbootTimer);
  };
}