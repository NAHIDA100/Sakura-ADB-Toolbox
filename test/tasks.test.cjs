'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskManager } = require('../electron/services/tasks.cjs');

function createLog() {
  const entries = [];
  return { entries, add(entry) { entries.push(entry); } };
}

function createHarness() {
  const calls = [];
  const events = [];
  let doneResolve;
  let done = new Promise((resolve) => { doneResolve = resolve; });
  const runner = {
    calls,
    async run(exe, args, options = {}) {
      calls.push({ exe, args });
      if (options.onLine) {
        options.onLine('stdout line', 'stdout');
        options.onLine('stderr line', 'stderr');
      }
      return { exe, args, code: 0, stdout: 'ok', stderr: '', durationMs: 4 };
    },
    start(exe, args, options = {}) {
      calls.push({ exe, args });
      if (options.onLine) options.onLine('stream output', 'stdout');
      let cancelled = false;
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ code: 0, stdout: 'ok', stderr: '', durationMs: 5, cancelled }), 10);
        timer.unref && timer.unref();
      });
      return { child: { on() {} }, promise, cancel() { cancelled = true; } };
    }
  };
  const log = createLog();
  const manager = new TaskManager({
    runner,
    log,
    getTools: () => ({ adbPath: 'C:\\adb.exe', fastbootPath: 'C:\\fastboot.exe' }),
    sendToWindow: (channel, event) => {
      events.push(event);
      if (event.type === 'done') doneResolve(event);
    }
  });
  return { manager, runner, log, events, done: () => done, resetDone: () => { done = new Promise((resolve) => { doneResolve = resolve; }); } };
}

test('runs a destructive task with staged output and completion', async () => {
  const h = createHarness();
  const donePromise = h.done();
  h.manager.start({
    kind: 'flash',
    serial: 'FAST1',
    destructive: true,
    execute: async (ctx) => {
      await ctx.command({ label: '刷写 boot', tool: 'C:\\fastboot.exe', args: ['-s', 'FAST1', 'flash', 'boot', 'boot.img'], timeoutMs: 1000 });
      return 0;
    }
  });
  const done = await donePromise;
  assert.equal(done.code, 0);
  assert.equal(h.runner.calls.length, 1);
  assert.equal(h.manager.hasDestructive(), false);
  assert.ok(h.events.some((e) => e.type === 'stage'));
  assert.ok(h.events.some((e) => e.type === 'output' && e.lines.some((line) => line.line === 'stdout line')));
  assert.ok(h.log.entries.some((e) => e.message.includes('fastboot.exe')));
});

test('rejects a second destructive task while one is running', async () => {
  const h = createHarness();
  const donePromise = h.done();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  h.manager.start({
    kind: 'flash',
    destructive: true,
    execute: async () => { await gate; return 0; }
  });
  assert.throws(() => h.manager.start({ kind: 'wipe', destructive: true, execute: async () => 0 }), /正在进行/);
  release();
  await donePromise;
  assert.equal(h.manager.hasDestructive(), false);
});

test('terminal injects selected serial and completes', async () => {
  const h = createHarness();
  h.resetDone();
  const donePromise = h.done();
  const started = h.manager.startTerminal({ command: 'shell getprop', adbSerial: 'ABC123', fastbootSerial: 'FAST1' });
  assert.ok(started.runId);
  const done = await donePromise;
  assert.equal(done.code, 0);
  assert.deepEqual(h.runner.calls[0].args, ['-s', 'ABC123', 'shell', 'getprop']);
});
