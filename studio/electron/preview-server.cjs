const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { allowedFiles, loadProjectAt, readAllowedFile } = require('./project-service.cjs');

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
]);

function send(response, status, headers = {}, body = '') {
  response.writeHead(status, {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=()',
    ...headers,
  });
  response.end(body);
}

function createPreviewServer(projectRoot, getEditorOrigin) {
  const bridgePath = path.join(__dirname, 'preview-bridge.js');
  const server = http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.setHeader('Allow', 'GET, HEAD');
      return send(response, 405);
    }
    let pathname;
    let query;
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1/');
      pathname = decodeURIComponent(url.pathname);
      query = url.searchParams;
    } catch {
      return send(response, 400);
    }

    if (pathname === '/__studio/preview-bridge.js') {
      const editorOrigin = getEditorOrigin();
      const session = query.get('studioSession');
      const parentOrigin = query.get('studioParent');
      if (!editorOrigin || !session || session.length < 32 || parentOrigin !== editorOrigin) return send(response, 404);
      try {
        const script = await fs.readFile(bridgePath, 'utf8');
        return send(response, 200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Content-Security-Policy': `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors ${editorOrigin}`,
        }, request.method === 'HEAD' ? '' : script);
      } catch {
        return send(response, 500);
      }
    }

    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    if (!allowedFiles.has(relativePath)) return send(response, 404);
    if (!projectRoot) return send(response, 503);

    try {
      // loadProjectAt canonicalizes the root and rejects symlinks before the preview reads files.
      const activeProject = await loadProjectAt(projectRoot);
      let body = await readAllowedFile(activeProject.root, relativePath);
      const editorOrigin = getEditorOrigin();
      if (relativePath === 'index.html') {
        if (!editorOrigin) return send(response, 503);
        const bridgeSession = query.get('studioSession') || '';
        if (!/^[a-f0-9]{64}$/.test(bridgeSession)) return send(response, 400);
        const html = body.toString('utf8');
        const bridgeQuery = new URLSearchParams({ studioParent: editorOrigin, studioSession: bridgeSession }).toString().replaceAll('&', '&amp;');
        const bridge = `<script src="/__studio/preview-bridge.js?${bridgeQuery}"></script>`;
        if (!html.includes('</head>')) return send(response, 400);
        body = Buffer.from(html.replace('</head>', `${bridge}</head>`));
      }
      const editorOriginValue = getEditorOrigin();
      const csp = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors ${editorOriginValue}`;
      const headers = {
        'Content-Type': contentTypes.get(path.extname(relativePath).toLowerCase()) || 'application/octet-stream',
        'Content-Security-Policy': csp,
      };
      if (request.method === 'HEAD') {
        headers['Content-Length'] = String(body.length);
        return send(response, 200, headers);
      }
      headers['Content-Length'] = String(body.length);
      return send(response, 200, headers, body);
    } catch (error) {
      return send(response, error.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Arquivo de prévia indisponível.');
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
    setProjectRoot(root) {
      projectRoot = root;
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

module.exports = { createPreviewServer };
