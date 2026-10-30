const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function createContentSecurityPolicy(previewOrigin, development = false, rendererOrigin = '') {
  const directives = [
    "default-src 'self'",
    `script-src 'self'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${development && rendererOrigin ? ` ws://${rendererOrigin.slice('http://'.length)}` : ''}`,
    `frame-src ${previewOrigin || "'none'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  return directives.join('; ');
}

function createStaticServer(root, getPreviewOrigin) {
  const server = http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.setHeader('Allow', 'GET, HEAD');
      response.writeHead(405).end();
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1/').pathname); }
    catch { response.writeHead(400).end(); return; }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const candidate = path.resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    try {
      const resolved = await fs.realpath(candidate);
      if (!resolved.startsWith(root + path.sep) || !(await fs.stat(resolved)).isFile()) { response.writeHead(404).end(); return; }
      const body = await fs.readFile(resolved);
      const headers = {
        'Content-Type': contentTypes.get(path.extname(resolved).toLowerCase()) || 'application/octet-stream',
        'Content-Length': String(body.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': createContentSecurityPolicy(getPreviewOrigin(), false),
      };
      response.writeHead(200, headers);
      response.end(request.method === 'HEAD' ? '' : body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve(`http://127.0.0.1:${server.address().port}`);
        });
      });
    },
    close() { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}

module.exports = { createContentSecurityPolicy, createStaticServer };
