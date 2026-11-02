'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SettingsStore } = require('../electron/services/settings.cjs');
const { detectTools } = require('../electron/services/tools.cjs');
const { FileVault } = require('../electron/services/files.cjs');
const { buildFlashSteps } = require('../electron/services/flash.cjs');
const { buildWipeSteps } = require('../electron/services/wipe.cjs');
const { humanizeFailure } = require('../electron/services/runner.cjs');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('settings persist across instances', () => {
  const dir = tempDir('sakura-settings-');
  const first = new SettingsStore(dir).init();
  first.save({ adbPath: 'C:\\adb.exe', reducedMotion: true });
  first.saveWindowBounds({ width: 1200, height: 760, x: 20, y: 30, maximized: true });
  const second = new SettingsStore(dir).init();
  assert.equal(second.get().adbPath, 'C:\\adb.exe');
  assert.equal(second.get().reducedMotion, true);
  assert.equal(second.getWindowBounds().width, 1200);
  assert.equal(second.getWindowBounds().maximized, true);
});

test('detects adb and fastboot from a configured directory', () => {
  const dir = tempDir('sakura-tools-');
  fs.writeFileSync(path.join(dir, 'adb.exe'), 'x');
  fs.writeFileSync(path.join(dir, 'fastboot.exe'), 'x');
  const tools = detectTools({ platform: 'win32', env: {}, configured: { adbPath: dir } });
  assert.equal(tools.adbFound, true);
  assert.equal(tools.fastbootFound, true);
  assert.equal(path.basename(tools.adbPath), 'adb.exe');
  assert.equal(path.basename(tools.fastbootPath), 'fastboot.exe');
});

test('file vault validates APK header and image hash', async () => {
  const dir = tempDir('sakura-files-');
  const apk = path.join(dir, 'demo.apk');
  fs.writeFileSync(apk, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('demo')]));
  const bad = path.join(dir, 'bad.apk');
  fs.writeFileSync(bad, Buffer.from('not zip'));
  const image = path.join(dir, 'boot.img');
  fs.writeFileSync(image, Buffer.from('boot image'));
  const vault = new FileVault({ root: dir });
  const apkRecord = await vault.register(apk, 'apk');
  assert.equal(apkRecord.name, 'demo.apk');
  assert.ok(apkRecord.token);
  assert.ok(vault.consume(apkRecord.token, 'apk'));
  assert.throws(() => vault.get(apkRecord.token), /失效/);
  await assert.rejects(() => vault.register(bad, 'apk'), /有效的 APK/);
  const imageRecord = await vault.register(image, 'image');
  assert.equal(imageRecord.sha256.length, 64);
  assert.ok(vault.get(imageRecord.token, 'image'));
});

test('builds fastboot flash and wipe command sequences', () => {
  const flash = buildFlashSteps({
    serial: 'FAST1',
    partition: 'boot',
    filePath: 'C:\\boot.img',
    fastbootPath: 'C:\\fastboot.exe',
    reboot: true
  });
  assert.equal(flash.steps[0].args[0], '-s');
  assert.equal(flash.steps[0].args[3], 'boot');
  assert.equal(flash.steps[1].args[2], 'reboot');
  assert.throws(() => buildFlashSteps({ serial: 'FAST1', partition: 'boot; rm', filePath: 'a', fastbootPath: 'f' }), /分区/);

  const wipe = buildWipeSteps({ serial: 'FAST1', data: true, cache: true, reboot: false, fastbootPath: 'C:\\fastboot.exe' });
  assert.equal(wipe.steps.length, 2);
  assert.deepEqual(wipe.steps[0].args, ['-s', 'FAST1', '-w']);
  assert.ok(wipe.steps[1].tolerate.test('unknown partition'));
});

test('humanizes common adb failures', () => {
  assert.equal(humanizeFailure({ stdout: '', stderr: 'error: device unauthorized', code: 1 }, 'adb').code, 'UNAUTHORIZED');
  assert.equal(humanizeFailure({ stdout: '', stderr: 'error: no devices/emulators found', code: 1 }, 'adb').code, 'NO_DEVICE');
  assert.equal(humanizeFailure({ stdout: '', stderr: "FAILED (remote: 'Flashing is not allowed in Lock State')", code: 1 }, 'fastboot').code, 'BOOTLOADER_LOCKED');
  assert.equal(humanizeFailure({ timedOut: true, stderr: '', stdout: '', code: -1 }, 'adb').code, 'TIMEOUT');
});
