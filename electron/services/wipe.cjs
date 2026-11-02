'use strict';
const { validateSerial } = require('./command.cjs');

function buildWipeSteps(options) {
  const serial = validateSerial(options.serial);
  const tool = options.fastbootPath;
  if (!tool) throw new Error('未找到 fastboot，请在设置中指定 platform-tools 路径');
  const steps = [];
  if (options.data) {
    steps.push({
      label: '清除用户数据（fastboot -w）',
      tool,
      args: ['-s', serial, '-w'],
      timeoutMs: 8 * 60 * 1000
    });
  }
  if (options.cache) {
    steps.push({
      label: '清除缓存分区',
      tool,
      args: ['-s', serial, 'erase', 'cache'],
      timeoutMs: 2 * 60 * 1000,
      tolerate: /unknown partition|partition not found|no such partition|not found/i,
      skipLabel: '设备没有独立 cache 分区，已跳过'
    });
  }
  if (!steps.length) throw new Error('至少选择清除用户数据或缓存');
  if (options.reboot) {
    steps.push({
      label: '重启设备',
      tool,
      args: ['-s', serial, 'reboot'],
      timeoutMs: 60 * 1000
    });
  }
  return { serial, steps };
}

module.exports = { buildWipeSteps };
