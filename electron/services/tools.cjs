'use strict';
const fs = require('node:fs');
const path = require('node:path');

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function exeName(kind, platform) {
  if (platform === 'win32') return kind + '.exe';
  return kind;
}

function resolveTool(input, kind, platform, existsSync) {
  if (!input) return null;
  const name = exeName(kind, platform);
  const raw = String(input).trim().replace(/^"|"$/g, '');
  if (!raw) return null;
  let target = raw;
  try {
    const stat = fs.statSync(raw);
    if (stat.isDirectory()) target = path.join(raw, name);
  } catch {
    if (!path.extname(raw)) target = path.join(raw, name);
  }
  return existsSync(target) ? target : null;
}

function detectTools(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const configured = options.configured || {};
  const existsSync = options.existsSync || fs.existsSync;
  const adbName = exeName('adb', platform);
  const fastbootName = exeName('fastboot', platform);
  const dirs = [];
  const add = (value) => { if (value) dirs.push(String(value).replace(/^"|"$/g, '')); };
  const pathEntries = String(env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);

  add(env.ADB_PATH);
  add(env.ANDROID_HOME && path.join(env.ANDROID_HOME, 'platform-tools'));
  add(env.ANDROID_SDK_ROOT && path.join(env.ANDROID_SDK_ROOT, 'platform-tools'));
  pathEntries.forEach(add);

  if (platform === 'win32') {
    add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools'));
    add(env.USERPROFILE && path.join(env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools'));
    add('C:\\Android\\Sdk\\platform-tools');
    add('D:\\Android\\Sdk\\platform-tools');
    add('C:\\platform-tools');
    add('D:\\platform-tools');
  } else {
    add(env.HOME && path.join(env.HOME, 'Library', 'Android', 'sdk', 'platform-tools'));
    add(env.HOME && path.join(env.HOME, 'Android', 'Sdk', 'platform-tools'));
    add('/usr/local/platform-tools');
    add('/opt/android-sdk/platform-tools');
  }

  const adbFromConfigured = resolveTool(configured.adbPath, 'adb', platform, existsSync);
  let adbPath = adbFromConfigured;
  if (!adbPath) {
    for (const dir of unique(dirs)) {
      const candidate = path.join(dir, adbName);
      if (existsSync(candidate)) { adbPath = candidate; break; }
    }
  }

  const fastbootFromConfigured = resolveTool(configured.fastbootPath, 'fastboot', platform, existsSync);
  let fastbootPath = fastbootFromConfigured;
  if (!fastbootPath) {
    const candidateDirs = unique([adbPath ? path.dirname(adbPath) : null, ...dirs]);
    for (const dir of candidateDirs) {
      const candidate = path.join(dir, fastbootName);
      if (existsSync(candidate)) { fastbootPath = candidate; break; }
    }
  }

  return {
    adbPath: adbPath || '',
    fastbootPath: fastbootPath || '',
    adbFound: Boolean(adbPath),
    fastbootFound: Boolean(fastbootPath),
    searchedDirs: unique(dirs).slice(0, 40),
    platform
  };
}

function toolFilename(kind, platform = process.platform) {
  return exeName(kind, platform);
}

module.exports = { detectTools, toolFilename };
