'use strict';
const { spawn } = require('node:child_process');

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(value) {
  return String(value == null ? '' : value).replace(ANSI_RE, '');
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
    } catch {
      // Best effort; the process may already have exited.
    }
    return;
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

function createLineSplitter(onLine) {
  let buffer = '';
  return {
    push(text) {
      buffer += stripAnsi(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.length) onLine(line);
      }
      if (buffer.length > 65536) {
        onLine(buffer);
        buffer = '';
      }
    },
    flush() {
      if (buffer.length) {
        onLine(buffer);
        buffer = '';
      }
    }
  };
}

class Runner {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.platform = options.platform || process.platform;
  }

  start(exe, args, options = {}) {
    if (!exe) {
      return {
        child: null,
        promise: Promise.reject(Object.assign(new Error('没有找到可执行工具'), { code: 'TOOL_NOT_FOUND' })),
        cancel() {}
      };
    }
    const timeoutMs = Number(options.timeoutMs || 0);
    const maxBytes = Number(options.maxBytes || 4 * 1024 * 1024);
    const encoding = options.encoding === null ? null : 'utf8';
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutBuffers = [];
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let timer = null;
    let forceTimer = null;
    let child;

    const promise = new Promise((resolve, reject) => {
      try {
        child = spawn(exe, args, {
          windowsHide: true,
          env: this.env,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        reject(Object.assign(error, { code: error.code || 'SPAWN_FAILED', exe }));
        return;
      }

      if (typeof options.onSpawn === 'function') {
        try { options.onSpawn(child); } catch { /* observer error */ }
      }

      const finish = (code, signal, error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        if (options.onLine) {
          // Flush is handled by splitters below.
        }
        let buffer;
        if (encoding === null) buffer = Buffer.concat(stdoutBuffers, stdoutBytes);
        const result = {
          exe,
          args,
          code: typeof code === 'number' ? code : -1,
          signal: signal || null,
          stdout,
          stderr,
          buffer,
          durationMs: Date.now() - startedAt,
          timedOut,
          cancelled,
          truncated,
          error: error ? { code: error.code || 'SPAWN_FAILED', message: error.message } : undefined
        };
        if (error) {
          reject(Object.assign(error, { result }));
        } else {
          resolve(result);
        }
      };

      const stdoutLines = encoding === null ? null : createLineSplitter((line) => {
        if (typeof options.onLine === 'function') options.onLine(line, 'stdout');
      });
      const stderrLines = encoding === null ? null : createLineSplitter((line) => {
        if (typeof options.onLine === 'function') options.onLine(line, 'stderr');
      });

      const append = (stream, chunk) => {
        if (encoding === null) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (stdoutBytes + buf.length <= maxBytes) {
            stdoutBuffers.push(buf);
            stdoutBytes += buf.length;
          } else {
            truncated = true;
          }
          if (typeof options.onStdout === 'function') options.onStdout(buf);
          return;
        }
        const text = String(chunk);
        if (stream === 'stdout') {
          if (stdout.length + text.length <= maxBytes) stdout += text;
          else truncated = true;
          if (typeof options.onStdout === 'function') options.onStdout(stripAnsi(text));
          stdoutLines.push(text);
        } else {
          if (stderr.length + text.length <= maxBytes) stderr += text;
          else truncated = true;
          if (typeof options.onStderr === 'function') options.onStderr(stripAnsi(text));
          stderrLines.push(text);
        }
      };

      child.stdout.on('data', (chunk) => append('stdout', chunk));
      child.stderr.on('data', (chunk) => append('stderr', chunk));
      child.on('error', (error) => {
        if (stdoutLines) stdoutLines.flush();
        if (stderrLines) stderrLines.flush();
        finish(null, null, error);
      });
      child.on('close', (code, signal) => {
        if (stdoutLines) stdoutLines.flush();
        if (stderrLines) stderrLines.flush();
        finish(code, signal, null);
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
          forceTimer = setTimeout(() => {
            if (!settled) {
              finish(-1, null, new Error('命令执行超时'));
            }
          }, 3000);
        }, timeoutMs);
      }
    });

    return {
      child,
      promise,
      cancel() {
        if (settled) return;
        cancelled = true;
        killTree(child && child.pid);
      }
    };
  }

  async run(exe, args, options = {}) {
    const task = this.start(exe, args, options);
    return task.promise;
  }

  async runBuffer(exe, args, options = {}) {
    const task = this.start(exe, args, { ...options, encoding: null });
    return task.promise;
  }
}

function humanizeFailure(result, tool = 'adb') {
  const text = [result && result.stdout, result && result.stderr].filter(Boolean).join('\n');
  const lower = text.toLowerCase();
  if (result && result.timedOut) {
    return { code: 'TIMEOUT', message: tool + ' 命令执行超时，请检查设备连接后重试', detail: text };
  }
  if (result && result.cancelled) {
    return { code: 'CANCELLED', message: '命令已停止', detail: text };
  }
  if (result && result.error && result.error.code === 'ENOENT') {
    return { code: 'TOOL_NOT_FOUND', message: '找不到 ' + tool + '，请在设置中指定 platform-tools 路径', detail: text };
  }
  if (lower.includes('unauthorized')) {
    return { code: 'UNAUTHORIZED', message: '设备未授权：请解锁手机并在 USB 调试弹窗中点击允许', detail: text };
  }
  if (lower.includes('no permissions')) {
    return { code: 'NO_PERMISSION', message: '没有权限访问该设备，请检查 USB 调试授权或驱动', detail: text };
  }
  if (lower.includes('more than one device') || lower.includes('more than one emulator')) {
    return { code: 'MULTIPLE_DEVICES', message: '连接了多台设备，请先在左侧选择目标设备', detail: text };
  }
  if (lower.includes('device offline') || lower.includes('device still connecting')) {
    return { code: 'DEVICE_OFFLINE', message: '设备处于离线状态，请重新插拔 USB 或重启 ADB 服务', detail: text };
  }
  if (lower.includes('no devices/emulators found') || lower.includes('no devices found')) {
    return { code: 'NO_DEVICE', message: '没有检测到在线设备，请检查 USB 调试和 ADB 授权', detail: text };
  }
  if (lower.includes('flashing is not allowed') || lower.includes('not allowed in lock state')) {
    return { code: 'BOOTLOADER_LOCKED', message: 'Bootloader 已锁定，无法刷写；请先确认设备已解锁', detail: text };
  }
  if (lower.includes('unknown partition') || lower.includes('partition not found') || lower.includes('no such partition')) {
    return { code: 'PARTITION_NOT_FOUND', message: '设备上不存在该分区，请核对分区名', detail: text };
  }
  if (lower.includes('cannot open') && tool === 'fastboot') {
    return { code: 'FASTBOOT_FAILED', message: 'Fastboot 无法访问设备，请检查驱动、数据线与 Bootloader 状态', detail: text };
  }
  if (result && result.code !== 0) {
    const lastLine = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-1)[0];
    return {
      code: 'COMMAND_FAILED',
      message: lastLine ? ('操作失败：' + lastLine.slice(0, 220)) : (tool + ' 命令执行失败'),
      detail: text
    };
  }
  return null;
}

module.exports = { Runner, humanizeFailure, stripAnsi, killTree };
