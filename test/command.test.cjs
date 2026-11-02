'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tokenize,
  parseTerminalCommand,
  validateSerial,
  validatePackageName,
  validatePartition,
  validatePairCode,
  validateHost,
  validatePort,
  displayCommand
} = require('../electron/services/command.cjs');

test('tokenizes quoted commands and Windows paths', () => {
  const tokens = tokenize('shell "pm list packages | grep foo"');
  assert.deepEqual(tokens, ['shell', 'pm list packages | grep foo']);
  const pathTokens = tokenize('push "C:\\My Files\\a.apk" /sdcard/a.apk');
  assert.deepEqual(pathTokens, ['push', 'C:\\My Files\\a.apk', '/sdcard/a.apk']);
  assert.throws(() => tokenize('shell "unterminated'), /引号/);
});

test('keeps global adb commands without a serial', () => {
  const parsed = parseTerminalCommand('devices -l', { adbSerial: 'ABC123' });
  assert.equal(parsed.mode, 'adb');
  assert.deepEqual(parsed.args, ['devices', '-l']);
  assert.equal(parsed.isGlobal, true);
});

test('injects -s for device adb commands', () => {
  const parsed = parseTerminalCommand('shell getprop ro.product.model', { adbSerial: 'ABC123' });
  assert.deepEqual(parsed.args, ['-s', 'ABC123', 'shell', 'getprop', 'ro.product.model']);
  assert.match(parsed.displayCommand, /^adb -s ABC123 shell/);
});

test('does not duplicate explicit device selection', () => {
  const parsed = parseTerminalCommand('adb -s XYZ shell whoami', { adbSerial: 'ABC123' });
  assert.deepEqual(parsed.args, ['-s', 'XYZ', 'shell', 'whoami']);
});

test('handles fastboot mode and serial injection', () => {
  const parsed = parseTerminalCommand('fastboot flash boot boot.img', { fastbootSerial: 'FAST1' });
  assert.equal(parsed.mode, 'fastboot');
  assert.deepEqual(parsed.args, ['-s', 'FAST1', 'flash', 'boot', 'boot.img']);
  const global = parseTerminalCommand('fastboot devices', { fastbootSerial: 'FAST1' });
  assert.deepEqual(global.args, ['devices']);
  assert.equal(global.isGlobal, true);
});

test('validates serial, package, partition, host and port', () => {
  assert.equal(validateSerial('ABC-123'), 'ABC-123');
  assert.throws(() => validateSerial('bad serial'), /序列号/);
  assert.equal(validatePackageName('com.example.app_1'), 'com.example.app_1');
  assert.throws(() => validatePackageName('com..bad'), /包名/);
  assert.equal(validatePartition('vendor_boot'), 'vendor_boot');
  assert.throws(() => validatePartition('boot; rm -rf'), /分区/);
  assert.equal(validatePairCode('123456'), '123456');
  assert.throws(() => validatePairCode('12ab56'), /配对码/);
  assert.equal(validateHost('192.168.1.20'), '192.168.1.20');
  assert.throws(() => validateHost('host name'), /主机/);
  assert.equal(validatePort('5555'), 5555);
  assert.throws(() => validatePort('70000'), /端口/);
});

test('quotes display arguments safely', () => {
  assert.equal(displayCommand('adb', ['shell', 'echo hello world']), 'adb shell "echo hello world"');
});
