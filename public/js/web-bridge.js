(function () {
  if (window.sakura) return;
  document.documentElement.classList.add('web-mode');
  const taskSubs = new Set();
  const logSubs = new Set();
  const source = new EventSource('/api/events');
  source.addEventListener('task', (event) => { try { const data = JSON.parse(event.data); taskSubs.forEach((fn) => { try { fn(data); } catch (error) { console.error(error); } }); } catch {} });
  source.addEventListener('log', (event) => { try { const data = JSON.parse(event.data); logSubs.forEach((fn) => { try { fn(data); } catch (error) { console.error(error); } }); } catch {} });
  const bad = (message, code) => ({ ok: false, error: { code: code || 'WEB_ERROR', message: String(message || '操作失败'), detail: '' } });
  async function request(url, options) {
    try {
      const response = await fetch(url, options);
      return await response.json();
    } catch (error) {
      return bad(error.message, 'NETWORK');
    }
  }
  const get = (url) => request(url);
  const post = (url, body) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  async function pick(kind) {
    const file = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = kind === 'apk' ? '.apk' : '.img,.bin';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => resolve(input.files && input.files[0] ? input.files[0] : null), { once: true });
      input.click();
    });
    if (!file) return { ok: true, data: null };
    const response = await fetch('/api/upload?kind=' + encodeURIComponent(kind) + '&name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
    return response.json();
  }
  window.sakura = {
    system: {
      health: () => get('/api/system/health'),
      appInfo: () => get('/api/system/appInfo'),
      openDataDir: () => get('/api/system/openDataDir'),
      showItemInFolder: () => ({ ok: true, data: { shown: false } })
    },
    settings: {
      get: () => get('/api/settings'),
      save: (patch) => post('/api/settings', patch),
      detect: () => get('/api/settings/detect'),
      browseAdb: () => ({ ok: false, error: { code: 'WEB_NO_DIALOG', message: '浏览器版请直接粘贴 ADB 路径', detail: '' } }),
      browseFastboot: () => ({ ok: false, error: { code: 'WEB_NO_DIALOG', message: '浏览器版请直接粘贴 Fastboot 路径', detail: '' } })
    },
    devices: {
      list: () => get('/api/devices'),
      action: (payload) => post('/api/device/action', payload),
      mode: (serial) => get('/api/device/mode?serial=' + encodeURIComponent(serial)),
      reboot: (payload) => post('/api/device/reboot', payload),
      metrics: (serial) => get('/api/device/metrics?serial=' + encodeURIComponent(serial)),
      connect: (payload) => post('/api/wireless/connect', payload),
      pair: (payload) => post('/api/wireless/pair', payload),
      disconnect: (payload) => post('/api/wireless/disconnect', payload)
    },
    apps: {
      list: (payload) => get('/api/apps?serial=' + encodeURIComponent(payload.serial) + '&filter=' + encodeURIComponent(payload.filter || 'third') + (payload.refresh ? '&refresh=1' : '')),
      action: (payload) => post('/api/apps/action', payload),
      install: (payload) => post('/api/install', payload),
      export: () => ({ ok: false, error: { code: 'WEB_EXPORT', message: '浏览器版暂不支持导出 APK，请使用应用内终端 adb pull', detail: '' } })
    },
    activate: {
      list: (payload) => get('/api/activate/apps?serial=' + encodeURIComponent(payload.serial)),
      run: (payload) => post('/api/activate/run', payload),
      open: (payload) => post('/api/activate/open', payload),
      accounts: (payload) => post('/api/activate/accounts', payload)
    },
    files: { pick },
    flash: { start: (payload) => post('/api/flash', payload) },
    wipe: { start: (payload) => post('/api/wipe', payload) },
    terminal: { start: (payload) => post('/api/terminal/start', payload), stop: (runId) => post('/api/terminal/stop', { runId }) },
    screenshot: { capture: (serial) => post('/api/screenshot', { serial }) },
    logs: {
      list: () => get('/api/logs'),
      clear: () => post('/api/logs/clear', {}),
      export: () => get('/api/logs/export'),
      onAppend: (callback) => { logSubs.add(callback); return () => logSubs.delete(callback); }
    },
    task: { onEvent: (callback) => { taskSubs.add(callback); return () => taskSubs.delete(callback); } },
    window: {
      minimize: () => ({ ok: true, data: { ok: true } }),
      toggleMaximize: () => ({ ok: true, data: { maximized: false } }),
      close: () => ({ ok: true, data: { ok: true } }),
      isMaximized: () => ({ ok: true, data: { maximized: false } }),
      onMaximizedChange: () => () => {}
    }
  };
})();