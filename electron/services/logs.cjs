'use strict';

class LogStore {
  constructor(limit = 500) {
    this.limit = limit;
    this.entries = [];
    this.nextId = 1;
    this.listeners = new Set();
  }

  add(input = {}) {
    const entry = {
      id: this.nextId++,
      ts: new Date().toISOString(),
      level: input.level || 'info',
      source: input.source || 'system',
      message: String(input.message || ''),
      detail: input.detail ? String(input.detail).slice(0, 4000) : undefined
    };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    for (const listener of this.listeners) {
      try { listener(entry); } catch { /* ignore UI listener errors */ }
    }
    return entry;
  }

  list() {
    return this.entries.slice();
  }

  clear() {
    this.entries = [];
    return { cleared: true };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  toText() {
    return this.entries.map((entry) => {
      const time = new Date(entry.ts).toLocaleString('zh-CN', { hour12: false });
      const detail = entry.detail ? '\n  ' + entry.detail.replace(/\n/g, '\n  ') : '';
      return '[' + time + '] [' + entry.level.toUpperCase() + '] [' + entry.source + '] ' + entry.message + detail;
    }).join('\n');
  }
}

module.exports = { LogStore };
