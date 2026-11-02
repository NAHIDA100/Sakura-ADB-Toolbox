'use strict';
const crypto = require('node:crypto');
const { displayCommand, parseTerminalCommand } = require('./command.cjs');
const { humanizeFailure } = require('./runner.cjs');

class TaskError extends Error {
  constructor(message, detail, code) {
    super(message);
    this.name = 'TaskError';
    this.detail = detail || '';
    this.code = code || 'TASK_FAILED';
  }
}

class TaskManager {
  constructor(options) {
    this.runner = options.runner;
    this.log = options.log;
    this.getTools = options.getTools;
    this.sendToWindow = options.sendToWindow || (() => {});
    this.tasks = new Map();
    this.destructive = null;
    this.outputTimers = new Map();
  }

  hasDestructive() {
    return Boolean(this.destructive);
  }

  _send(event) {
    try { this.sendToWindow('task:event', event); } catch { /* window may be gone */ }
  }

  _queueOutput(task, stream, line) {
    if (!line) return;
    task.output.push({ stream, line });
    if (task.outputTimer) return;
    task.outputTimer = setTimeout(() => this._flushOutput(task), 35);
  }

  _flushOutput(task) {
    if (task.outputTimer) {
      clearTimeout(task.outputTimer);
      task.outputTimer = null;
    }
    if (!task.output.length) return;
    const lines = task.output.splice(0, task.output.length);
    this._send({ runId: task.runId, type: 'output', lines });
  }

  _emit(task, type, payload = {}) {
    this._flushOutput(task);
    this._send({ runId: task.runId, type, ...payload });
  }

  _complete(task, code) {
    this._flushOutput(task);
    if (task.outputTimer) clearTimeout(task.outputTimer);
    this._send({ runId: task.runId, type: 'done', code, durationMs: Date.now() - task.startedAt });
    if (this.destructive === task) this.destructive = null;
    this.tasks.delete(task.runId);
  }

  _fail(task, error) {
    this._flushOutput(task);
    const message = error && error.message ? error.message : '操作失败';
    const detail = error && error.detail ? error.detail : '';
    this._send({ runId: task.runId, type: 'error', message, detail, code: error && error.code ? error.code : 'TASK_FAILED' });
    if (this.destructive === task) this.destructive = null;
    this.tasks.delete(task.runId);
    this._send({ runId: task.runId, type: 'done', code: -1, durationMs: Date.now() - task.startedAt });
  }

  async _command(task, step) {
    const display = displayCommand(step.tool, step.args);
    this._emit(task, 'stage', { label: step.label || '执行命令' });
    this.log.add({ level: 'info', source: task.kind, message: display });
    const result = await this.runner.run(step.tool, step.args, {
      timeoutMs: step.timeoutMs || 120000,
      onLine: (line, stream) => this._queueOutput(task, stream, line)
    });
    if (result.code !== 0) {
      const failure = humanizeFailure(result, task.kind === 'flash' || task.kind === 'wipe' ? 'fastboot' : 'adb');
      const detail = [result.stdout, result.stderr].filter(Boolean).join('\n');
      if (step.tolerate && step.tolerate.test(detail)) {
        this._emit(task, 'stage', { label: step.skipLabel || '已跳过可选步骤' });
        this.log.add({ level: 'warn', source: task.kind, message: step.skipLabel || '可选步骤已跳过', detail });
        return result;
      }
      const error = new TaskError(
        (failure && failure.message) || ('命令失败：' + display),
        (failure && failure.detail) || detail,
        failure && failure.code
      );
      this.log.add({ level: 'error', source: task.kind, message: error.message, detail: error.detail });
      throw error;
    }
    if (result.truncated) this._queueOutput(task, 'stderr', '[输出过长，已省略部分内容]');
    return result;
  }

  start(options) {
    const runId = options.runId || crypto.randomUUID();
    const task = {
      runId,
      kind: options.kind || 'task',
      serial: options.serial || '',
      destructive: Boolean(options.destructive),
      cancellable: Boolean(options.cancellable),
      startedAt: Date.now(),
      output: [],
      outputTimer: null,
      cancel: null
    };
    if (task.destructive) {
      if (this.destructive) throw new TaskError('已有刷写或双清任务正在进行，请等待完成', '', 'BUSY');
      this.destructive = task;
    }
    this.tasks.set(runId, task);

    const ctx = {
      runId,
      serial: task.serial,
      emit: (type, payload) => this._emit(task, type, payload),
      stage: (label) => this._emit(task, 'stage', { label }),
      line: (line, stream = 'stdout') => this._queueOutput(task, stream, line),
      command: (step) => this._command(task, step),
      setCancel: (fn) => { task.cancel = fn; },
      checkCancelled: () => task.cancelled,
      runner: this.runner
    };

    Promise.resolve().then(async () => {
      try {
        this._emit(task, 'start', { kind: task.kind, serial: task.serial });
        const code = await options.execute(ctx);
        if (task.cancelled) {
          this._complete(task, -1);
          return;
        }
        this._complete(task, typeof code === 'number' ? code : 0);
      } catch (error) {
        this._fail(task, error);
      }
    });

    return { runId };
  }

  startTerminal(options) {
    const parsed = parseTerminalCommand(options.command, {
      adbSerial: options.adbSerial,
      fastbootSerial: options.fastbootSerial
    });
    const tools = this.getTools();
    const exe = parsed.mode === 'fastboot' ? tools.fastbootPath : tools.adbPath;
    if (!exe) {
      throw new TaskError(
        '找不到 ' + parsed.mode + '，请在设置中指定 platform-tools 路径',
        '',
        'TOOL_NOT_FOUND'
      );
    }
    return this.start({
      kind: 'terminal',
      runId: options.runId,
      serial: parsed.serial,
      cancellable: true,
      execute: async (ctx) => {
        ctx.stage('$ ' + parsed.displayCommand);
        const handle = this.runner.start(exe, parsed.args, {
          timeoutMs: 0,
          onLine: (line, stream) => ctx.line(line, stream)
        });
        ctx.setCancel(() => handle.cancel());
        if (handle.child) {
          handle.child.on('error', () => {});
        }
        const result = await handle.promise;
        if (result.cancelled) {
          ctx.emit('stage', { label: '终端命令已停止' });
          return -1;
        }
        if (result.code !== 0) {
          const failure = humanizeFailure(result, parsed.mode);
          const detail = [result.stdout, result.stderr].filter(Boolean).join('\n');
          throw new TaskError((failure && failure.message) || '命令执行失败', (failure && failure.detail) || detail, failure && failure.code);
        }
        return 0;
      }
    });
  }

  stop(runId) {
    const task = this.tasks.get(runId);
    if (!task) return { stopped: false };
    if (!task.cancellable) throw new TaskError('该任务不可取消', '', 'NOT_CANCELLABLE');
    task.cancelled = true;
    if (typeof task.cancel === 'function') {
      try { task.cancel(); } catch { /* ignore */ }
    }
    this.log.add({ level: 'warn', source: 'terminal', message: '已请求停止终端命令' });
    return { stopped: true };
  }

  shutdown() {
    for (const task of this.tasks.values()) {
      if (task.cancellable && typeof task.cancel === 'function') {
        try { task.cancel(); } catch { /* ignore */ }
      }
    }
  }
}

module.exports = { TaskManager, TaskError };
