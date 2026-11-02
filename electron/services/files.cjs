'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_APK = 2 * 1024 * 1024 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024 * 1024;

function extOf(file) {
  return path.extname(file).toLowerCase();
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

class FileVault {
  constructor(options) {
    this.root = options.root;
    this.tokens = new Map();
    this.maxApk = options.maxApk || MAX_APK;
    this.maxImage = options.maxImage || MAX_IMAGE;
  }

  async pick(window, dialog, kind) {
    const isApk = kind === 'apk';
    const result = await dialog.showOpenDialog(window, {
      title: isApk ? '选择要安装的 APK' : '选择要刷写的镜像',
      properties: ['openFile'],
      filters: isApk
        ? [{ name: 'Android 应用', extensions: ['apk'] }]
        : [{ name: 'Android 镜像', extensions: ['img', 'bin'] }, { name: '所有文件', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return null;
    return this.register(result.filePaths[0], kind);
  }

  async register(filePath, kind) {
    if (!['apk', 'image'].includes(kind)) throw new Error('不支持的文件类型');
    const resolved = path.resolve(String(filePath || ''));
    let stat;
    try { stat = fs.statSync(resolved); } catch { throw new Error('文件不存在或无法读取'); }
    if (!stat.isFile()) throw new Error('请选择文件而不是文件夹');
    if (kind === 'apk') {
      if (extOf(resolved) !== '.apk') throw new Error('请选择 .apk 文件');
      if (stat.size <= 0 || stat.size > this.maxApk) throw new Error('APK 大小必须在 1 字节到 2GB 之间');
      const fd = fs.openSync(resolved, 'r');
      const head = Buffer.alloc(4);
      try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
      if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error('该文件不是有效的 APK（ZIP 头校验失败）');
    } else {
      if (!['.img', '.bin'].includes(extOf(resolved))) throw new Error('请选择 .img 或 .bin 镜像');
      if (stat.size <= 0 || stat.size > this.maxImage) throw new Error('镜像大小必须在 1 字节到 4GB 之间');
    }
    const sha256 = kind === 'image' ? await hashFile(resolved) : '';
    const token = crypto.randomUUID();
    const record = {
      token,
      kind,
      path: resolved,
      name: path.basename(resolved),
      size: stat.size,
      sha256,
      createdAt: Date.now()
    };
    this.tokens.set(token, record);
    return this.publicRecord(record);
  }

  publicRecord(record) {
    return {
      token: record.token,
      kind: record.kind,
      name: record.name,
      size: record.size,
      sha256: record.sha256
    };
  }

  get(token, kind) {
    const record = this.tokens.get(String(token || ''));
    if (!record) throw new Error('文件令牌已失效，请重新选择文件');
    if (kind && record.kind !== kind) throw new Error('文件类型与操作不匹配');
    if (Date.now() - record.createdAt > 30 * 60 * 1000) {
      this.tokens.delete(record.token);
      throw new Error('文件令牌已过期，请重新选择文件');
    }
    if (!fs.existsSync(record.path)) throw new Error('原文件已被移动或删除，请重新选择');
    return record;
  }

  consume(token, kind) {
    const record = this.get(token, kind);
    this.tokens.delete(record.token);
    return record;
  }

  cleanup() {
    const now = Date.now();
    for (const [token, record] of this.tokens) {
      if (now - record.createdAt > 30 * 60 * 1000) this.tokens.delete(token);
    }
  }
}

module.exports = { FileVault, hashFile };
