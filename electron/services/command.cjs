'use strict';

const ADB_GLOBAL = new Set([
  'devices', 'start-server', 'kill-server', 'version', 'connect', 'disconnect',
  'pair', 'help', 'wait-for-any-device', 'reconnect', 'mdns', 'keygen'
]);
const FASTBOOT_GLOBAL = new Set(['devices', 'version', 'help']);

function tokenize(input) {
  const text = String(input || '');
  const tokens = [];
  let current = '';
  let quote = null;
  let hasToken = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      current += ch;
      hasToken = true;
      escaped = false;
      continue;
    }
    if (quote !== "'" && ch === '\\') {
      const next = text[i + 1];
      if (next === '"' || next === "'" || next === ' ' || next === '\\') {
        escaped = true;
        hasToken = true;
        continue;
      }
      current += ch;
      hasToken = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      hasToken = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }

  if (quote) throw new Error('命令中的引号没有闭合');
  if (escaped) current += '\\';
  if (hasToken) tokens.push(current);
  return tokens;
}

function displayArg(arg) {
  if (arg === '') return '""';
  if (!/[\s"]/g.test(arg)) return arg;
  return '"' + arg.replace(/"/g, '\\"') + '"';
}

function displayCommand(binary, args) {
  return [binary, ...args].map(displayArg).join(' ');
}

function validateSerial(serial) {
  const value = String(serial || '').trim();
  if (!value) throw new Error('请先选择设备');
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error('设备序列号格式不正确');
  return value;
}

function validatePackageName(pkg) {
  const value = String(pkg || '').trim();
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(value)) throw new Error('应用包名格式不正确');
  return value;
}

function validatePartition(partition) {
  const value = String(partition || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(value)) throw new Error('分区名只能包含字母、数字、下划线和短横线');
  return value;
}

function validatePairCode(code) {
  const value = String(code || '').trim();
  if (!/^\d{6}$/.test(value)) throw new Error('无线调试配对码应为 6 位数字');
  return value;
}

function validateHost(host) {
  const value = String(host || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,255}$/.test(value)) throw new Error('主机地址格式不正确');
  return value;
}

function validatePort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('端口应为 1-65535 的整数');
  return value;
}

function parseTerminalCommand(input, options = {}) {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error('请输入 adb 或 fastboot 命令');
  let mode = 'adb';
  if (tokens[0].toLowerCase() === 'adb' || tokens[0].toLowerCase() === 'adb.exe') {
    tokens.shift();
    mode = 'adb';
  } else if (tokens[0].toLowerCase() === 'fastboot' || tokens[0].toLowerCase() === 'fastboot.exe') {
    tokens.shift();
    mode = 'fastboot';
  }
  if (tokens.length === 0) throw new Error('请输入 adb 或 fastboot 命令');

  const globals = mode === 'adb' ? ADB_GLOBAL : FASTBOOT_GLOBAL;
  const serial = mode === 'adb' ? options.adbSerial : options.fastbootSerial;
  const first = String(tokens[0]).toLowerCase();
  const hasDeviceFlag = tokens.some((arg) => arg === '-s' || arg === '-d' || arg === '-e' || arg === '--device');
  const isGlobal = globals.has(first);
  const args = tokens.slice();

  if (serial && !isGlobal && !hasDeviceFlag) {
    validateSerial(serial);
    args.unshift('-s', serial);
  }

  return {
    mode,
    args,
    serial: serial || '',
    isGlobal,
    displayCommand: displayCommand(mode, args)
  };
}

module.exports = {
  ADB_GLOBAL,
  FASTBOOT_GLOBAL,
  tokenize,
  displayArg,
  displayCommand,
  parseTerminalCommand,
  validateSerial,
  validatePackageName,
  validatePartition,
  validatePairCode,
  validateHost,
  validatePort
};
