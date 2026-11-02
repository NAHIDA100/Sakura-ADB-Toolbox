'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateSerial } = require('./command.cjs');
const { humanizeFailure } = require('./runner.cjs');
const { parsePng } = require('./parsers.cjs');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

class ScreenshotService {
  constructor(options) {
    this.runner = options.runner;
    this.getTools = options.getTools;
    this.baseDir = options.baseDir;
    this.log = options.log;
  }

  async capture(serial) {
    const target = validateSerial(serial);
    const tools = this.getTools();
    if (!tools.adbPath) throw new Error('未找到 adb');
    this.log.add({ level: 'info', source: 'screenshot', message: '正在截取设备屏幕 · ' + target });
    const result = await this.runner.runBuffer(tools.adbPath, ['-s', target, 'exec-out', 'screencap', '-p'], { timeoutMs: 45000, maxBytes: 30 * 1024 * 1024 });
    if (result.code !== 0) {
      const failure = humanizeFailure(result, 'adb');
      throw Object.assign(new Error((failure && failure.message) || '截图失败'), { detail: [result.stdout, result.stderr].filter(Boolean).join('\n') });
    }
    const png = parsePng(result.buffer);
    if (!png.ok) throw new Error('设备返回的截图不是有效的 PNG 数据');
    const dir = path.join(this.baseDir, 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'ADB-' + stamp() + '.png');
    fs.writeFileSync(filePath, result.buffer);
    this.log.add({ level: 'success', source: 'screenshot', message: '截图已保存：' + filePath });
    return {
      filePath,
      width: png.width,
      height: png.height,
      dataUrl: 'data:image/png;base64,' + result.buffer.toString('base64'),
      capturedAt: new Date().toISOString()
    };
  }
}

module.exports = { ScreenshotService };
