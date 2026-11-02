export function createRouter(options) {
  const container = options.container;
  const routes = options.routes;
  const onRoute = options.onRoute || (() => {});
  let currentCleanup = null;
  let currentPath = '';
  let sequence = 0;

  function normalize(value) {
    let path = String(value || '').replace(/^#/, '');
    const q = path.indexOf('?');
    if (q >= 0) path = path.slice(0, q);
    if (!path.startsWith('/')) path = '/' + path;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path || '/dashboard';
  }

  function currentHash() {
    return normalize(window.location.hash || '#/dashboard');
  }

  async function render() {
    const path = currentHash();
    if (path === currentPath) return;
    currentPath = path;
    const token = ++sequence;
    if (typeof currentCleanup === 'function') {
      try { currentCleanup(); } catch (error) { console.error(error); }
    }
    currentCleanup = null;
    const route = routes[path] || routes['/dashboard'];
    if (!route) return;
    container.scrollTop = 0;
    const view = document.createElement('section');
    view.className = 'view is-entering';
    view.dataset.route = path;
    container.replaceChildren(view);
    onRoute(path, route);
    try {
      const cleanup = await route.mount(view, { navigate, refresh: render });
      if (token !== sequence) {
        if (typeof cleanup === 'function') cleanup();
        return;
      }
      currentCleanup = typeof cleanup === 'function' ? cleanup : null;
    } catch (error) {
      console.error(error);
      view.innerHTML = '<div class="panel glass"><div class="empty-state"><div class="empty-state__art">!</div><strong>页面加载失败</strong><p>' + String(error && error.message || error) + '</p></div></div>';
    }
    setTimeout(() => view.classList.remove('is-entering'), 760);
  }

  function navigate(path) {
    const normalized = normalize(path);
    if (currentHash() === normalized) {
      render();
      return;
    }
    window.location.hash = '#' + normalized;
  }

  function start() {
    if (!window.location.hash) window.location.hash = '#/dashboard';
    window.addEventListener('hashchange', render);
    render();
    return () => {
      window.removeEventListener('hashchange', render);
      if (typeof currentCleanup === 'function') currentCleanup();
    };
  }

  return { start, navigate, render, get current() { return currentPath; } };
}
