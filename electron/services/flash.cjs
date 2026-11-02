'use strict';
const { validateSerial, validatePartition } = require('./command.cjs');

const PARTITIONS = ['boot', 'init_boot', 'recovery', 'vbmeta', 'vendor_boot', 'dtbo'];

function buildFlashSteps(options) {
  const serial = validateSerial(options.serial);
  const partition = validatePartition(options.partition);
  const tool = options.fastbootPath;
  if (!tool) throw new Error('未找到 fastboot，请在设置中指定 platform-tools 路径');
  const steps = [{
    label: '刷写分区 ' + partition,
    tool,
    args: ['-s', serial, 'flash', partition, options.filePath],
    timeoutMs: 15 * 60 * 1000
  }];
  if (options.reboot) {
    steps.push({
      label: '重启设备',
      tool,
      args: ['-s', serial, 'reboot'],
      timeoutMs: 60 * 1000
    });
  }
  return { serial, partition, steps };
}

module.exports = { buildFlashSteps, PARTITIONS };
