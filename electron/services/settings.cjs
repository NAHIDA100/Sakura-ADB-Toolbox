'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({
  adbPath: '',
  fastbootPath: '',
  reducedMotion: false
});

const DEFAULT_WINDOW = Object.freeze({
  width: 1440,
  height: 900,
  x: undefined,
  y: undefined,
  maximized: false
});

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    console.error('SETTINGS_WRITE_FAILED', file, error && error.message);
    return false;
  }
}

class SettingsStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.file = path.join(baseDir, 'settings.json');
    this.windowFile = path.join(baseDir, 'window-state.json');
    this.settings = { ...DEFAULT_SETTINGS };
    this.window = { ...DEFAULT_WINDOW };
  }

  init() {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const saved = readJson(this.file, {});
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in saved && typeof saved[key] === typeof DEFAULT_SETTINGS[key]) {
        this.settings[key] = saved[key];
      }
    }
    const savedWindow = readJson(this.windowFile, {});
    for (const key of Object.keys(DEFAULT_WINDOW)) {
      if (key in savedWindow) this.window[key] = savedWindow[key];
    }
    return this;
  }

  get() {
    return { ...this.settings };
  }

  save(patch = {}) {
    for (const key of ['adbPath', 'fastbootPath']) {
      if (key in patch) this.settings[key] = String(patch[key] || '').trim();
    }
    if ('reducedMotion' in patch) this.settings.reducedMotion = Boolean(patch.reducedMotion);
    writeJson(this.file, this.settings);
    return this.get();
  }

  getWindowBounds() {
    return { ...this.window };
  }

  saveWindowBounds(bounds = {}) {
    if (Number.isFinite(bounds.width) && bounds.width > 400) this.window.width = Math.round(bounds.width);
    if (Number.isFinite(bounds.height) && bounds.height > 300) this.window.height = Math.round(bounds.height);
    if (Number.isFinite(bounds.x)) this.window.x = Math.round(bounds.x);
    if (Number.isFinite(bounds.y)) this.window.y = Math.round(bounds.y);
    if (typeof bounds.maximized === 'boolean') this.window.maximized = bounds.maximized;
    writeJson(this.windowFile, this.window);
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS, DEFAULT_WINDOW };