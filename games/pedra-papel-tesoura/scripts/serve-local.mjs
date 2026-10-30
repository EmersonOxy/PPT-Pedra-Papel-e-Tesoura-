import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = await realpath(resolve(fileURLToPath(new URL('..', import.meta.url))));
const host = '127.0.0.1';
const port = Number(process.env.TRINDADE_PORT || 4173);
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
]);

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', `http://${host}:${port}`).pathname);
  } catch {
    response.writeHead(400).end('Invalid URL');
    return;
  }

  const relativePath = pathname === '/' ? '/index.html' : pathname;
  if (relativePath.split('/').some((part) => part.startsWith('.'))) {
    response.writeHead(404).end('Not found');
    return;
  }
  const candidate = resolve(projectRoot, `.${relativePath}`);
  if (candidate !== projectRoot && !candidate.startsWith(projectRoot + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const filePath = await realpath(candidate);
    if (filePath !== projectRoot && !filePath.startsWith(projectRoot + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const details = await stat(filePath);
    if (!details.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
      'Content-Length': details.size,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Jogo local: http://${host}:${port}/\n`);
  process.stdout.write('Servidor somente leitura; pressione Ctrl+C para encerrar.\n');
});

server.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
