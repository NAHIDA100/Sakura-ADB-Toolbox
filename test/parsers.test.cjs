'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAdbDevices,
  parseFastbootDevices,
  parsePackages,
  parseMetrics,
  parsePng,
  parsePmPath,
  formatDeviceState
} = require('../electron/services/parsers.cjs');

test('parses adb devices with model, product and states', () => {
  const text = [
    'List of devices attached',
    'R58M123ABC device product:beyond1 model:SM_G973F device:beyond1 transport_id:2',
    'emulator-5554 offline',
    '9BQDY4M7XK unauthorized product:tapas model:Redmi_Note_12',
    ''
  ].join('\n');
  const devices = parseAdbDevices(text);
  assert.equal(devices.length, 3);
  assert.equal(devices[0].serial, 'R58M123ABC');
  assert.equal(devices[0].state, 'device');
  assert.equal(devices[0].model, 'SM G973F');
  assert.equal(devices[0].transportId, '2');
  assert.equal(devices[1].state, 'offline');
  assert.equal(devices[2].state, 'unauthorized');
});

test('parses empty and daemon adb output', () => {
  assert.deepEqual(parseAdbDevices('List of devices attached\n\n'), []);
  assert.deepEqual(parseAdbDevices('* daemon started successfully\nList of devices attached\n'), []);
});

test('parses fastboot devices', () => {
  const devices = parseFastbootDevices('FAST8PRO001\tfastboot\n\n');
  assert.equal(devices.length, 1);
  assert.equal(devices[0].serial, 'FAST8PRO001');
  assert.equal(devices[0].state, 'fastboot');
});

test('parses package paths and deduplicates', () => {
  const text = [
    'package:/data/app/~~a/base.apk=com.tencent.mm',
    'package:/data/app/~~b/base.apk=com.spotify.music',
    'package:/data/app/~~a/base.apk=com.tencent.mm',
    'package:/system/priv-app/Settings/Settings.apk=com.android.settings'
  ].join('\n');
  const packages = parsePackages(text);
  assert.equal(packages.length, 3);
  assert.equal(packages[0].package, 'com.android.settings');
  assert.equal(packages.find((p) => p.package === 'com.tencent.mm').apkPath, '/data/app/~~a/base.apk');
});

test('parses combined metrics sections', () => {
  const text = [
    '__SAKURA_BATTERY__',
    'Current Battery Service state:',
    '  level: 45',
    '  temperature: 385',
    '__SAKURA_MEM__',
    'MemTotal:       8000000 kB',
    'MemAvailable:   3000000 kB',
    '__SAKURA_DF__',
    'Filesystem     1K-blocks    Used Available Use% Mounted on',
    '/dev/block/dm-1  100000    50000     50000  50% /data',
    '__SAKURA_CPU__',
    'TOTAL: 12% user + 3% kernel + 1% iowait + 0.5% irq + 0.5% softirq'
  ].join('\n');
  const metrics = parseMetrics(text);
  assert.equal(metrics.batteryPercent, 45);
  assert.equal(metrics.temperatureC, 38.5);
  assert.equal(metrics.memTotalKb, 8000000);
  assert.equal(metrics.memUsedKb, 5000000);
  assert.equal(metrics.storageTotalKb, 100000);
  assert.equal(metrics.storageUsedKb, 50000);
  assert.equal(metrics.cpuPercent, 17);
});

test('parses PNG header and package path', () => {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
  png.writeUInt32BE(1080, 16);
  png.writeUInt32BE(2400, 20);
  assert.deepEqual(parsePng(png), { ok: true, width: 1080, height: 2400 });
  assert.deepEqual(parsePng(Buffer.from('not a png')), { ok: false });
  assert.equal(parsePmPath('package:/data/app/base.apk\npackage:/data/app/split.apk'), '/data/app/base.apk');
  assert.equal(parsePmPath(''), null);
});

test('formats device state names', () => {
  assert.equal(formatDeviceState('device'), '已连接');
  assert.equal(formatDeviceState('unauthorized'), '未授权');
  assert.equal(formatDeviceState('weird'), 'weird');
});
