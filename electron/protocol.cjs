'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { protocol } = require('electron');

const SCHEME = 'sakura';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }]);
}

function installProtocol(publicRoot) {
  const root = path.resolve(publicRoot);
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app') return new Response('Not found', { status: 404 });
      let pathname = decodeURIComponent(url.pathname || '/');
      if (pathname === '/' || pathname === '') pathname = '/index.html';
      const filePath = path.resolve(root, '.' + pathname);
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      const data = await fs.readFile(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Cache-Control': 'no-store',
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff'
        }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { SCHEME, CSP, registerScheme, installProtocol };
