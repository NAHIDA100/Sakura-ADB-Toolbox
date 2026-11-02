'use strict';

const MARKERS = {
  battery: '__SAKURA_BATTERY__',
  mem: '__SAKURA_MEM__',
  df: '__SAKURA_DF__',
  cpu: '__SAKURA_CPU__'
};

function parseAdbDevices(text) {
  const devices = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('*') || line.startsWith('adb server') || line.startsWith('adb: ')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    let state = parts[1];
    let attrStart = 2;
    if (state === 'no' && parts[2] === 'permissions') {
      state = 'no permissions';
      attrStart = 3;
    }
    if (!/^[A-Za-z0-9._:-]+$/.test(serial)) continue;
    const attrs = {};
    for (let i = attrStart; i < parts.length; i += 1) {
      const idx = parts[i].indexOf(':');
      if (idx > 0) attrs[parts[i].slice(0, idx)] = parts[i].slice(idx + 1);
    }
    devices.push({
      serial,
      state,
      model: attrs.model ? attrs.model.replace(/_/g, ' ') : '',
      product: attrs.product || '',
      device: attrs.device || '',
      transportId: attrs.transport_id || '',
      raw: line
    });
  }
  return devices;
}

function parseFastbootDevices(text) {
  const devices = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^< waiting/i.test(line) || line.startsWith('fastboot: error')) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && parts[1] === 'fastboot' && /^[A-Za-z0-9._:-]+$/.test(parts[0])) {
      devices.push({ serial: parts[0], state: 'fastboot' });
    }
  }
  return devices;
}

function parsePackages(text) {
  const packages = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('package:')) continue;
    const body = line.slice('package:'.length);
    const eq = body.lastIndexOf('=');
    let apkPath = '';
    let pkg = '';
    if (eq > 0) {
      apkPath = body.slice(0, eq);
      pkg = body.slice(eq + 1);
    } else {
      pkg = body;
    }
    if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(pkg)) continue;
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    packages.push({ package: pkg, apkPath, label: pkg.split('.').slice(-1)[0] });
  }
  packages.sort((a, b) => a.package.localeCompare(b.package));
  return packages;
}

function sectionsFromMetrics(text) {
  const sections = { battery: '', mem: '', df: '', cpu: '' };
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === MARKERS.battery) { current = 'battery'; continue; }
    if (trimmed === MARKERS.mem) { current = 'mem'; continue; }
    if (trimmed === MARKERS.df) { current = 'df'; continue; }
    if (trimmed === MARKERS.cpu) { current = 'cpu'; continue; }
    if (current) sections[current] += line + '\n';
  }
  return sections;
}

function firstNumber(regex, text, fallback = null) {
  const match = String(text || '').match(regex);
  if (!match) return fallback;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : fallback;
}

function parseMetrics(text) {
  const sections = sectionsFromMetrics(text);
  const memTotalKb = firstNumber(/MemTotal:\s*(\d+)\s*kB/i, sections.mem);
  const memAvailableKb = firstNumber(/MemAvailable:\s*(\d+)\s*kB/i, sections.mem, firstNumber(/MemFree:\s*(\d+)\s*kB/i, sections.mem, null));
  const memUsedKb = memTotalKb != null && memAvailableKb != null ? Math.max(0, memTotalKb - memAvailableKb) : null;

  let storageTotalKb = null;
  let storageUsedKb = null;
  const dfLines = sections.df.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of dfLines) {
    if (/^Filesystem/i.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const total = Number(parts[1]);
    const used = Number(parts[2]);
    if (Number.isFinite(total) && Number.isFinite(used) && total > 0) {
      storageTotalKb = total;
      storageUsedKb = used;
      break;
    }
  }

  let cpuPercent = null;
  const totalLine = (sections.cpu.match(/TOTAL:\s*([^\n]+)/i) || [])[1];
  if (totalLine) {
    let sum = 0;
    let found = false;
    for (const match of totalLine.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
      sum += Number(match[1]);
      found = true;
    }
    if (found) cpuPercent = Math.max(0, Math.min(100, Math.round(sum * 10) / 10));
  }
  if (cpuPercent == null) {
    const topMatch = sections.cpu.match(/(\d+(?:\.\d+)?)\s*%\s*(?:cpu|user)/i);
    if (topMatch) cpuPercent = Number(topMatch[1]);
  }

  const batteryLevel = firstNumber(/level:\s*(\d+)/i, sections.battery);
  const temperatureRaw = firstNumber(/temperature:\s*(-?\d+)/i, sections.battery);
  return {
    cpuPercent,
    memTotalKb,
    memUsedKb,
    storageTotalKb,
    storageUsedKb,
    batteryPercent: batteryLevel != null ? Math.max(0, Math.min(100, Math.round(batteryLevel))) : null,
    temperatureC: temperatureRaw != null ? Math.round(temperatureRaw / 10 * 10) / 10 : null,
    capturedAt: new Date().toISOString()
  };
}

function parsePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return { ok: false };
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return { ok: false };
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return { ok: false };
  return { ok: true, width, height };
}

function parsePmPath(text) {
  const paths = String(text || '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => line.slice('package:'.length).trim())
    .filter(Boolean);
  if (!paths.length) return null;
  return paths.find((p) => /base\.apk$/i.test(p)) || paths[0];
}

function parseVersionLine(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
}

function formatDeviceState(state) {
  const map = {
    device: '已连接',
    offline: '离线',
    unauthorized: '未授权',
    bootloader: 'Fastboot',
    recovery: 'Recovery',
    sideload: 'Sideload',
    'no permissions': '无权限',
    fastboot: 'Fastboot'
  };
  return map[state] || state || '未知';
}

module.exports = {
  MARKERS,
  parseAdbDevices,
  parseFastbootDevices,
  parsePackages,
  parseMetrics,
  parsePng,
  parsePmPath,
  parseVersionLine,
  formatDeviceState
};
