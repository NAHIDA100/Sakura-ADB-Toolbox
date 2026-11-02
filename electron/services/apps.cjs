'use strict';
const { validateSerial, validatePackageName } = require('./command.cjs');
const { parsePackages, parsePmPath } = require('./parsers.cjs');
const { humanizeFailure } = require('./runner.cjs');

function failureFrom(result) {
  const failure = humanizeFailure(result, 'adb');
  return new Error((failure && failure.message) || 'ADB 命令执行失败');
}

class AppService {
  constructor(options) {
    this.runner = options.runner;
    this.getTools = options.getTools;
    this.log = options.log;
  }

  async list(serial, filter = 'third') {
    const target = validateSerial(serial);
    const tools = this.getTools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const onlyDisabled = filter === 'frozen';
    const baseFilter = onlyDisabled ? 'all' : filter;
    if (!['third', 'system', 'all'].includes(baseFilter)) throw new Error('无效的应用筛选条件');
    const flag = baseFilter === 'third' ? ['-3'] : baseFilter === 'system' ? ['-s'] : [];
    const args = ['-s', target, 'shell', 'pm', 'list', 'packages', '-f', ...flag];
    this.log.add({ level: 'info', source: 'apps', message: '读取应用列表 · ' + target });
    const result = await this.runner.run(tools.adbPath, args, { timeoutMs: 45000, maxBytes: 8 * 1024 * 1024 });
    if (result.code !== 0) {
      const failure = humanizeFailure(result, 'adb');
      throw Object.assign(new Error((failure && failure.message) || '读取应用列表失败'), { detail: [result.stdout, result.stderr].filter(Boolean).join('\n') });
    }
    const packages = parsePackages(result.stdout + '\n' + result.stderr);
    let disabledItems = [];
    try {
      const disabledResult = await this.runner.run(tools.adbPath, ['-s', target, 'shell', 'pm', 'list', 'packages', '-f', ...flag, '-d'], { timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 });
      if (disabledResult.code === 0) disabledItems = parsePackages(disabledResult.stdout + '\n' + disabledResult.stderr);
    } catch {}
    const disabled = new Set(disabledItems.map((item) => item.package));
    const map = new Map();
    for (const item of packages) {
      if (item.package === 'sakura.meta') continue;
      map.set(item.package, { ...item, disabled: disabled.has(item.package) });
    }
    for (const item of disabledItems) {
      if (item.package === 'sakura.meta' || map.has(item.package)) continue;
      map.set(item.package, { ...item, disabled: true });
    }
    let merged = Array.from(map.values());
    if (onlyDisabled) merged = merged.filter((item) => item.disabled);
    merged.sort((a, b) => a.package.localeCompare(b.package));
    return { serial: target, filter, packages: merged, count: merged.length, truncated: result.truncated, checkedAt: new Date().toISOString() };
  }

  async action(serial, pkg, action) {
    const target = validateSerial(serial);
    const packageName = validatePackageName(pkg);
    const tools = this.getTools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const map = {
      launch: { args: ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'], timeout: 25000, label: '启动应用' },
      'force-stop': { args: ['shell', 'am', 'force-stop', packageName], timeout: 25000, label: '强行停止' },
      clear: { args: ['shell', 'pm', 'clear', packageName], timeout: 45000, label: '清除应用数据' },
      uninstall: { args: ['shell', 'pm', 'uninstall', '--user', '0', packageName], timeout: 60000, label: '卸载应用' },
      disable: { args: ['shell', 'pm', 'disable-user', '--user', '0', packageName], timeout: 30000, label: '冻结应用' },
      enable: { args: ['shell', 'pm', 'enable', packageName], timeout: 30000, label: '解冻应用' }
    };
    if (!map[action]) throw new Error('不支持的应用操作');
    const step = map[action];
    this.log.add({ level: 'info', source: 'apps', message: step.label + ' · ' + packageName });
    const result = await this.runner.run(tools.adbPath, ['-s', target, ...step.args], { timeoutMs: step.timeout });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (result.code !== 0 || /^failure/i.test(output)) {
      const failure = humanizeFailure(result, 'adb');
      throw Object.assign(new Error((failure && failure.message) || (step.label + '失败')), { detail: output });
    }
    this.log.add({ level: 'success', source: 'apps', message: step.label + '完成 · ' + packageName });
    return { ok: true, action, package: packageName, output };
  }

  async apkPath(serial, pkg) {
    const target = validateSerial(serial);
    const packageName = validatePackageName(pkg);
    const tools = this.getTools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    const result = await this.runner.run(tools.adbPath, ['-s', target, 'shell', 'pm', 'path', packageName], { timeoutMs: 20000 });
    if (result.code !== 0) {
      const failure = humanizeFailure(result, 'adb');
      throw Object.assign(new Error((failure && failure.message) || '无法获取 APK 路径'), { detail: result.stderr });
    }
    const remote = parsePmPath(result.stdout);
    if (!remote) throw new Error('该应用没有可导出的 base APK（可能是系统拆分包）');
    return { package: packageName, remotePath: remote, serial: target };
  }
}

module.exports = { AppService };