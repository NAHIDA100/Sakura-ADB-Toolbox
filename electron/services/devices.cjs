'use strict';
const { validateSerial, validateHost, validatePort, validatePairCode } = require('./command.cjs');
const { humanizeFailure } = require('./runner.cjs');
const { parseAdbDevices, parseFastbootDevices, parseMetrics, parseVersionLine } = require('./parsers.cjs');

function failureFrom(result, tool) {
  const failure = humanizeFailure(result, tool);
  if (failure) return { code: failure.code, message: failure.message, detail: failure.detail };
  return { code: 'COMMAND_FAILED', message: tool + ' 命令执行失败', detail: [result.stdout, result.stderr].filter(Boolean).join('\n') };
}

class DeviceService {
  constructor(options) {
    this.runner = options.runner;
    this.getTools = options.getTools;
    this.log = options.log;
  }

  tools() {
    return this.getTools();
  }

  async list() {
    const tools = this.tools();
    const errors = [];
    let adb = [];
    let fastboot = [];
    const tasks = [];
    if (tools.adbPath) {
      tasks.push(this.runner.run(tools.adbPath, ['devices', '-l'], { timeoutMs: 12000 })
        .then((result) => {
          adb = parseAdbDevices([result.stdout, result.stderr].join('\n'));
          if (result.code !== 0 && result.stderr) errors.push({ source: 'adb', ...failureFrom(result, 'adb') });
        })
        .catch((error) => {
          errors.push({ source: 'adb', code: error.code || 'ADB_FAILED', message: error.message });
        }));
    } else {
      errors.push({ source: 'adb', code: 'TOOL_NOT_FOUND', message: '未找到 adb，请在设置中指定 platform-tools 路径' });
    }
    if (tools.fastbootPath) {
      tasks.push(this.runner.run(tools.fastbootPath, ['devices'], { timeoutMs: 12000 })
        .then((result) => {
          fastboot = parseFastbootDevices([result.stdout, result.stderr].join('\n'));
          if (result.code !== 0 && result.stderr) errors.push({ source: 'fastboot', ...failureFrom(result, 'fastboot') });
        })
        .catch((error) => {
          errors.push({ source: 'fastboot', code: error.code || 'FASTBOOT_FAILED', message: error.message });
        }));
    }
    await Promise.all(tasks);
    return { adb, fastboot, errors, checkedAt: new Date().toISOString() };
  }

  async version(kind) {
    const tools = this.tools();
    const exe = kind === 'fastboot' ? tools.fastbootPath : tools.adbPath;
    if (!exe) return { found: false, path: '', version: '', error: '未找到 ' + kind };
    try {
      const args = kind === 'fastboot' ? ['--version'] : ['version'];
      const result = await this.runner.run(exe, args, { timeoutMs: 8000 });
      const version = parseVersionLine([result.stdout, result.stderr].join('\n'));
      return { found: true, path: exe, version, error: result.code !== 0 ? (failureFrom(result, kind).message) : '' };
    } catch (error) {
      return { found: true, path: exe, version: '', error: error.message };
    }
  }

  async action(serial, action) {
    const target = validateSerial(serial);
    const tools = this.tools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const actions = {
      reboot: ['reboot'],
      bootloader: ['reboot', 'bootloader'],
      recovery: ['reboot', 'recovery'],
      disconnect: ['disconnect', target]
    };
    if (!actions[action]) throw new Error('不支持的设备操作');
    const args = action === 'disconnect' ? actions[action] : ['-s', target, ...actions[action]];
    this.log.add({ level: 'info', source: 'device', message: 'adb ' + args.join(' ') });
    const result = await this.runner.run(tools.adbPath, args, { timeoutMs: action === 'disconnect' ? 15000 : 30000 });
    if (result.code !== 0) {
      const failure = failureFrom(result, 'adb');
      throw Object.assign(new Error(failure.message), { detail: failure.detail, code: failure.code });
    }
    this.log.add({ level: 'success', source: 'device', message: '设备操作完成：' + action });
    return { ok: true, action, output: result.stdout.trim() };
  }

  async mode(serial) {
    const target = validateSerial(serial);
    const data = await this.list();
    if (data.fastboot.some((item) => item.serial === target)) {
      return { serial: target, mode: 'bootloader', bootCompleted: '', bootmode: 'fastboot' };
    }
    const adbDevice = data.adb.find((item) => item.serial === target);
    if (!adbDevice) throw new Error('设备不在线，无法检测当前模式');
    if (adbDevice.state === 'recovery' || adbDevice.state === 'sideload') {
      return { serial: target, mode: 'recovery', bootCompleted: '', bootmode: adbDevice.state, source: 'adb-state' };
    }
    const tools = this.tools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const [completed, bootmode] = await Promise.all([
      this.runner.run(tools.adbPath, ['-s', target, 'shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 10000 }).catch(() => ({ stdout: '' })),
      this.runner.run(tools.adbPath, ['-s', target, 'shell', 'getprop', 'ro.bootmode'], { timeoutMs: 10000 }).catch(() => ({ stdout: '' }))
    ]);
    const bootCompleted = String(completed.stdout || '').trim();
    const bootMode = String(bootmode.stdout || '').trim();
    const mode = bootMode === 'recovery' ? 'recovery' : bootCompleted === '1' ? 'system' : 'recovery';
    return { serial: target, mode, bootCompleted, bootmode: bootMode };
  }

  async rebootMode(serial, target) {
    const deviceSerial = validateSerial(serial);
    const targets = ['system', 'recovery', 'bootloader', 'download', 'poweroff', 'edl'];
    if (!targets.includes(target)) throw new Error('不支持的重启目标');
    const data = await this.list();
    const tools = this.tools();
    const inFastboot = data.fastboot.some((item) => item.serial === deviceSerial);
    let executable = '';
    let args = [];
    let currentMode = '';
    if (inFastboot) {
      if (!tools.fastbootPath) throw new Error('未找到 fastboot');
      const fastbootActions = {
        system: ['reboot'],
        recovery: ['reboot', 'recovery'],
        bootloader: ['reboot-bootloader'],
        edl: ['oem', 'edl']
      };
      if (!fastbootActions[target]) throw new Error('引导模式下不支持该重启目标');
      executable = tools.fastbootPath;
      args = ['-s', deviceSerial, ...fastbootActions[target]];
      currentMode = 'bootloader';
    } else {
      if (!data.adb.some((item) => item.serial === deviceSerial)) throw new Error('设备不在线');
      if (!tools.adbPath) throw new Error('未找到 adb');
      const adbActions = {
        system: ['reboot'],
        recovery: ['reboot', 'recovery'],
        bootloader: ['reboot', 'bootloader'],
        download: ['reboot', 'download'],
        poweroff: ['reboot', '-p'],
        edl: ['reboot', 'edl']
      };
      executable = tools.adbPath;
      args = ['-s', deviceSerial, ...adbActions[target]];
      currentMode = 'adb';
    }
    this.log.add({ level: 'info', source: 'device', message: '重启模式：' + (inFastboot ? 'fastboot' : 'adb') + ' -> ' + target + ' · ' + deviceSerial });
    const result = await this.runner.run(executable, args, { timeoutMs: 30000 });
    if (result.code !== 0) {
      const failure = failureFrom(result, inFastboot ? 'fastboot' : 'adb');
      throw Object.assign(new Error(failure.message), { detail: failure.detail, code: failure.code });
    }
    this.log.add({ level: 'success', source: 'device', message: '重启指令已发送：' + target + ' · ' + deviceSerial });
    return { ok: true, serial: deviceSerial, target, currentMode, output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() };
  }

  async connect(host, port) {
    const h = validateHost(host);
    const p = validatePort(port);
    const tools = this.tools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const address = h + ':' + p;
    const result = await this.runner.run(tools.adbPath, ['connect', address], { timeoutMs: 30000 });
    if (result.code !== 0 || /failed|cannot|unable/i.test(result.stdout + result.stderr)) {
      const failure = failureFrom(result, 'adb');
      throw Object.assign(new Error(failure.message), { detail: failure.detail, code: failure.code });
    }
    this.log.add({ level: 'success', source: 'device', message: '无线连接：' + address });
    return { ok: true, address, output: result.stdout.trim() };
  }

  async pair(host, port, code) {
    const h = validateHost(host);
    const p = validatePort(port);
    const pairCode = validatePairCode(code);
    const tools = this.tools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const address = h + ':' + p;
    const result = await this.runner.run(tools.adbPath, ['pair', address, pairCode], { timeoutMs: 45000 });
    if (result.code !== 0 || /failed|cannot|unable/i.test(result.stdout + result.stderr)) {
      const failure = failureFrom(result, 'adb');
      throw Object.assign(new Error(failure.message), { detail: failure.detail, code: failure.code });
    }
    this.log.add({ level: 'success', source: 'device', message: '无线配对成功：' + address });
    return { ok: true, address, output: result.stdout.trim() };
  }

  async disconnect(address) {
    const tools = this.tools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const args = address ? ['disconnect', address] : ['disconnect'];
    const result = await this.runner.run(tools.adbPath, args, { timeoutMs: 15000 });
    if (result.code !== 0) {
      const failure = failureFrom(result, 'adb');
      throw Object.assign(new Error(failure.message), { detail: failure.detail, code: failure.code });
    }
    return { ok: true, output: result.stdout.trim() };
  }

  async metrics(serial) {
    const target = validateSerial(serial);
    const tools = this.tools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const script = [
      'echo __SAKURA_BATTERY__; dumpsys battery',
      'echo __SAKURA_MEM__; cat /proc/meminfo',
      'echo __SAKURA_DF__; df -k /data',
      'echo __SAKURA_CPU__; dumpsys cpuinfo'
    ].join('; ');
    const result = await this.runner.run(tools.adbPath, ['-s', target, 'shell', script], { timeoutMs: 20000, maxBytes: 1024 * 1024 });
    if (result.code !== 0) {
      const failure = failureFrom(result, 'adb');
      throw Object.assign(new Error(failure.message), { detail: failure.detail, code: failure.code });
    }
    return parseMetrics(result.stdout + '\n' + result.stderr);
  }
}

module.exports = { DeviceService };