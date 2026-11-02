import { icon } from '../icons.js';
import { api, startTerminal, stopTerminal } from '../api.js';
import { state, subscribe, selectedAdbDevice, selectedFastbootDevice, setActiveAdb, setActiveFastboot } from '../store.js';
import { esc, formatDuration, deviceName, copyText } from '../dom.js';
import { toast, toastError } from '../components/toast.js';
import { demoGuard } from '../actions.js';

const QUICK = [
  { label: 'devices -l', command: 'devices -l' },
  { label: '型号', command: 'shell getprop ro.product.model' },
  { label: '第三方应用', command: 'shell pm list packages -3' },
  { label: '电池', command: 'shell dumpsys battery' },
  { label: '最近日志', command: 'logcat -d -t 120' }
];

const WELCOME = '<div class="terminal-welcome">Sakura ADB Toolbox <b>终端</b> · 直接调用 adb / fastboot<br>设备级命令会自动注入 -s 序列号；输入 help 查看使用说明。</div>';

function demoOutput(command) {
  const cmd = String(command).trim();
  if (cmd === 'devices -l' || cmd === 'adb devices -l') {
    return ['List of devices attached', '2B171FDH2000          device product:husky model:Pixel_8_Pro device:husky transport_id:3', 'R5CN30K9L8P          offline product:eureka model:Galaxy_S24', '9BQDY4M7XK          unauthorized product:tapas model:Redmi_Note_12'];
  }
  if (cmd.includes('ro.product.model')) return ['Pixel 8 Pro'];
  if (cmd.includes('pm list packages -3')) return ['package:com.tencent.mm', 'package:com.spotify.music', 'package:com.discord', 'package:com.netflix.mediaclient'];
  if (cmd.includes('dumpsys battery')) return ['Current Battery Service state:', '  AC powered: false', '  USB powered: true', '  status: 2', '  level: 86', '  temperature: 385'];
  if (cmd.includes('logcat')) return ['--------- beginning of main', '11-01 16:29:41.245  1204  1204 I ActivityManager: Start proc com.android.settings', '11-01 16:29:42.107  2311  2311 D WindowManager: relayout Visible', '11-01 16:29:43.001  1384  1384 I adbd    : adb connection established'];
  if (cmd.includes('fastboot devices')) return ['2B171FDH2000	fastboot'];
  if (cmd === 'help' || cmd === 'adb help') {
    return ['支持直接输入 adb 或 fastboot 命令。', '例如：adb shell getprop、devices -l、fastboot devices。', '设备级命令会自动追加 -s <serial>。'];
  }
  return ['< 演示模式：此命令没有真实执行。>'];
}

export async function mount(container) {
  let running = false;
  let currentRunId = null;
  let currentTask = null;
  let demoRunToken = 0;
  let history = [];
  try { history = JSON.parse(localStorage.getItem('sakura.terminalHistory') || '[]'); } catch { history = []; }
  if (!Array.isArray(history)) history = [];
  let historyIndex = history.length;
  let terminalChoice = state.activeAdbSerial ? 'adb:' + state.activeAdbSerial : (state.activeFastbootSerial ? 'fastboot:' + state.activeFastbootSerial : '');

  container.innerHTML =
    '<div class="page-head"><div class="page-head__copy"><div class="page-head__eyebrow">ADB TERMINAL</div><h1 class="page-title">应用内<span>终端</span></h1><p class="page-subtitle">直接调用本机 ADB 与 Fastboot。命令作为参数传给进程，不经过 shell 拼接。</p></div><div class="page-head__actions"><button class="btn btn--ghost" type="button" data-terminal-copy>' + icon('copy') + '复制输出</button><button class="btn btn--ghost" type="button" data-terminal-clear>' + icon('trash') + '清屏</button></div></div>' +
    '<section class="terminal-panel">' +
      '<div class="terminal-head"><span class="terminal-head__lights"><i></i><i></i><i></i></span><span class="terminal-head__title">sakura@adb <b>~</b></span><div class="terminal-head__right"><select class="select" data-terminal-device aria-label="终端设备"></select><span class="terminal-status"><span class="status-dot status-dot--online status-dot--pulse" data-terminal-dot></span><span data-terminal-state>就绪</span></span><button class="icon-btn icon-btn--small" type="button" data-terminal-copy title="复制输出">' + icon('copy') + '</button></div></div>' +
      '<div class="terminal-output" data-terminal-output>' + WELCOME + '</div>' +
      '<div class="terminal-quick">' + QUICK.map((item) => '<button type="button" data-command="' + esc(item.command) + '">' + item.label + '</button>').join('') + '</div>' +
      '<div class="terminal-input-row"><span class="terminal-prompt">❯</span><input class="terminal-input" data-terminal-input placeholder="输入 adb 或 fastboot 命令，例如 shell getprop ro.product.model" autocomplete="off" spellcheck="false" aria-label="ADB 命令"><button class="btn btn--primary" type="button" data-terminal-run>运行</button><button class="btn btn--ghost is-hidden" type="button" data-terminal-stop>停止</button></div>' +
    '</section>';

  const outputNode = container.querySelector('[data-terminal-output]');
  const inputNode = container.querySelector('[data-terminal-input]');
  const runButton = container.querySelector('[data-terminal-run]');
  const stopButton = container.querySelector('[data-terminal-stop]');
  const stateNode = container.querySelector('[data-terminal-state]');
  const dotNode = container.querySelector('[data-terminal-dot]');
  const deviceSelect = container.querySelector('[data-terminal-device]');

  const setStateLabel = (text, tone = 'online') => {
    stateNode.textContent = text;
    dotNode.className = 'status-dot status-dot--' + tone + (tone === 'online' ? ' status-dot--pulse' : '');
  };

  const setRunning = (value) => {
    running = value;
    runButton.disabled = value;
    runButton.textContent = value ? '执行中' : '运行';
    stopButton.classList.toggle('is-hidden', !value);
    if (!value) currentRunId = null;
  };

  const scroll = (force = false) => {
    const near = outputNode.scrollHeight - outputNode.scrollTop - outputNode.clientHeight < 90;
    if (force || near) outputNode.scrollTop = outputNode.scrollHeight;
  };

  const append = (text, type = '', force = false) => {
    const line = document.createElement('div');
    line.className = 'terminal-line' + (type ? ' terminal-line--' + type : '');
    line.textContent = text;
    outputNode.appendChild(line);
    while (outputNode.children.length > 1800) outputNode.firstElementChild.remove();
    scroll(force);
  };

  const appendWelcome = () => {
    outputNode.innerHTML = WELCOME;
  };

  const buildDeviceOptions = () => {
    const values = [];
    for (const device of state.devices.adb || []) {
      const label = (device.model || device.product || device.serial) + ' · adb' + (device.state === 'device' ? '' : ' · ' + device.state);
      values.push({ value: 'adb:' + device.serial, label });
    }
    for (const device of state.devices.fastboot || []) {
      values.push({ value: 'fastboot:' + device.serial, label: device.serial + ' · fastboot' });
    }
    if (!values.some((item) => item.value === terminalChoice)) {
      terminalChoice = values.length ? values[0].value : '';
    }
    const signature = JSON.stringify({ values, choice: terminalChoice });
    if (deviceSelect.dataset.signature === signature) return;
    deviceSelect.dataset.signature = signature;
    deviceSelect.innerHTML = values.length
      ? values.map((item) => '<option value="' + esc(item.value) + '" ' + (item.value === terminalChoice ? 'selected' : '') + '>' + esc(item.label) + '</option>').join('')
      : '<option value="">未连接设备</option>';
  };

  const renderSelection = () => {
    buildDeviceOptions();
    const [mode, ...rest] = terminalChoice.split(':');
    const serial = rest.join(':');
    if (mode === 'fastboot') {
      const device = (state.devices.fastboot || []).find((item) => item.serial === serial);
      if (device) setStateLabel(device.serial + ' · Fastboot', 'fastboot');
      else setStateLabel('未连接设备', 'offline');
    } else {
      const device = (state.devices.adb || []).find((item) => item.serial === serial);
      if (device) setStateLabel(deviceName(device) + ' · ADB', device.state === 'device' ? 'online' : 'warn');
      else setStateLabel('未连接设备', 'offline');
    }
  };

  const addHistory = (command) => {
    if (!command) return;
    history = history.filter((item) => item !== command);
    history.push(command);
    history = history.slice(-100);
    historyIndex = history.length;
    try { localStorage.setItem('sakura.terminalHistory', JSON.stringify(history)); } catch { /* ignore */ }
  };

  const executeDemo = async (command) => {
    const token = ++demoRunToken;
    setRunning(true);
    setStateLabel('执行中…', 'online');
    append('◆ 模拟执行：' + command, 'stage');
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (token !== demoRunToken) return;
    const lines = demoOutput(command);
    lines.forEach((line) => append(line));
    append('✓ 演示命令完成', 'stage');
    setRunning(false);
    setStateLabel('演示模式 · 就绪', 'online');
    append('', 'muted', true);
  };

  const execute = async (raw) => {
    const command = String(raw || '').trim();
    if (!command) return;
    if (command === 'clear' || command === 'cls') {
      appendWelcome();
      return;
    }
    if (command === 'help' || command === 'adb help') {
      demoOutput('help').forEach((line) => append(line));
      return;
    }
    if (running) return;
    addHistory(command);
    append('❯ ' + command, 'cmd', true);
    inputNode.value = '';
    if (state.demo) {
      await executeDemo(command);
      return;
    }
    if (demoGuard()) return;
    setRunning(true);
    setStateLabel('执行中…', 'online');
    const [choiceMode, ...choiceRest] = terminalChoice.split(':');
    const choiceSerial = choiceRest.join(':');
    const adb = choiceMode === 'adb' ? choiceSerial : state.activeAdbSerial;
    const fastboot = choiceMode === 'fastboot' ? choiceSerial : state.activeFastbootSerial;
    let completed = false;
    const task = startTerminal({ command, adbSerial: adb, fastbootSerial: fastboot }, {
      onStarted: (data) => {
        currentRunId = data && data.runId ? data.runId : currentRunId;
      },
      onStage: (label) => {
        append('◆ ' + label, 'stage');
      },
      onLine: (line, stream) => append(line, stream === 'stderr' ? 'stderr' : ''),
      onError: (event) => {
        append('错误：' + (event && event.message ? event.message : '命令执行失败'), 'stderr');
      },
      onDone: (result, error) => {
        completed = true;
        setRunning(false);
        if (error) {
          setStateLabel('执行失败', 'danger');
          append('✕ ' + (error.message || '执行失败') + ' · ' + formatDuration(result.durationMs), 'stderr', true);
          toast(error.message || '命令执行失败', 'error', (error.detail || '').split(/\r?\n/).slice(-2).join(' · '));
        } else if (result.code === -1) {
          setStateLabel('已停止', 'offline');
          append('✕ 命令已停止 · ' + formatDuration(result.durationMs), 'stderr', true);
        } else {
          setStateLabel('就绪', 'online');
          append('✓ 完成 · exit ' + result.code + ' · ' + formatDuration(result.durationMs), 'stage', true);
        }
        inputNode.focus();
      }
    });
    currentRunId = task.runId;
    currentTask = task;
    task.promise.catch((error) => {
      if (completed) return;
      completed = true;
      setRunning(false);
      setStateLabel('执行失败', 'danger');
      append('✕ ' + error.message, 'stderr', true);
      toastError(error, '命令执行失败');
    });
  };

  const stop = async () => {
    if (state.demo) {
      demoRunToken += 1;
      setRunning(false);
      setStateLabel('演示模式 · 就绪', 'online');
      append('✕ 演示命令已停止', 'stderr');
      return;
    }
    if (!currentRunId) return;
    try {
      await stopTerminal(currentRunId);
      toast('已请求停止终端命令', 'info');
    } catch (error) {
      toastError(error, '停止失败');
    }
  };

  const clear = () => {
    appendWelcome();
    setStateLabel('就绪', 'online');
    inputNode.focus();
  };

  const copy = async () => {
    const text = Array.from(outputNode.querySelectorAll('.terminal-line')).map((node) => node.textContent).join('\n');
    const ok = await copyText(text);
    toast(ok ? '终端输出已复制' : '复制失败', ok ? 'success' : 'error');
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      execute(inputNode.value);
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!history.length) return;
      event.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      inputNode.value = history[historyIndex] || '';
      setTimeout(() => inputNode.setSelectionRange(inputNode.value.length, inputNode.value.length), 0);
      return;
    }
    if (event.key === 'ArrowDown') {
      if (!history.length) return;
      event.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      inputNode.value = history[historyIndex] || '';
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      clear();
    }
  };

  const onClick = (event) => {
    if (event.target.closest('[data-terminal-run]')) {
      execute(inputNode.value);
      return;
    }
    if (event.target.closest('[data-terminal-stop]')) {
      stop();
      return;
    }
    if (event.target.closest('[data-terminal-clear]')) {
      clear();
      return;
    }
    if (event.target.closest('[data-terminal-copy]')) {
      copy();
      return;
    }
    const quick = event.target.closest('[data-command]');
    if (quick) {
      inputNode.value = quick.dataset.command;
      inputNode.focus();
    }
  };

  const onDeviceChange = () => {
    const value = deviceSelect.value;
    if (!value) return;
    terminalChoice = value;
    const [mode, ...rest] = value.split(':');
    const serial = rest.join(':');
    if (mode === 'fastboot') {
      setActiveFastboot(serial);
      toast('终端已切换 Fastboot 设备', 'success', serial);
    } else {
      setActiveAdb(serial);
      toast('终端已切换 ADB 设备', 'success', serial);
    }
    renderSelection();
  };

  container.addEventListener('click', onClick);
  inputNode.addEventListener('keydown', onKeyDown);
  deviceSelect.addEventListener('change', onDeviceChange);
  const unsubscribe = subscribe(renderSelection);
  renderSelection();
  inputNode.focus();

  return () => {
    unsubscribe();
    container.removeEventListener('click', onClick);
    inputNode.removeEventListener('keydown', onKeyDown);
    deviceSelect.removeEventListener('change', onDeviceChange);
    demoRunToken += 1;
    if (currentRunId && running) {
      stopTerminal(currentRunId).catch(() => {});
    }
  };
}
