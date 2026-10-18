import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { access, realpath, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(resolve(fileURLToPath(new URL('../../dist/web', import.meta.url))));
const contentTypes = new Map([
  ['.html', 'text/html'], ['.css', 'text/css'], ['.js', 'text/javascript'],
  ['.json', 'application/json'], ['.png', 'image/png'],
]);

async function walk(directory, prefix = '') {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await walk(resolve(directory, entry.name), path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Tipo de arquivo inesperado na saída: ${path}`);
  }
  return paths;
}

const expected = [
  'index.html',
  'config/editor-elements.schema.json',
  'config/visual.json',
  'assets/styles/game.css',
  'assets/images/hand-rock.png',
  'assets/images/hand-paper.png',
  'assets/images/hand-scissors.png',
  'src/game/core/rules.js',
  'src/game/main.js',
  'src/game/ui/game-animations.js',
  'src/game/ui/game-ui.js',
  'src/game/ui/game-view.js',
  'src/game/ui/turn-clock.js',
  'src/game/ui/visual-config.js',
].sort();
assert.deepEqual((await walk(root)).sort(), expected, 'A saída deve conter somente o allowlist web.');

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) return response.writeHead(405).end();
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1/').pathname); }
  catch { return response.writeHead(400).end(); }
  const relative = pathname === '/' ? '/index.html' : pathname;
  const candidate = resolve(root, `.${relative}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) return response.writeHead(403).end();
  try {
    const file = await realpath(candidate);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) return response.writeHead(404).end();
    response.writeHead(200, {
      'content-type': contentTypes.get(extname(file).toLowerCase()) || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end(); }
});

await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const rootResponse = await fetch(`${base}/`);
  assert.equal(rootResponse.status, 200);
  const html = await rootResponse.text();
  assert.match(html, /type="module"\s+src="\.\/src\/game\/main\.js"/);
  assert.match(html, /\.\/assets\/styles\/game\.css/);

  for (const path of expected.filter((path) => path !== 'index.html')) {
    const response = await fetch(`${base}/${path}`);
    assert.equal(response.status, 200, `${path} deve carregar na publicação.`);
    const expectedType = contentTypes.get(extname(path));
    if (expectedType) assert.match(response.headers.get('content-type'), new RegExp(`^${expectedType}`));
    if (path.endsWith('.json')) JSON.parse(await response.text());
  }

  for (const path of ['/docs/BUILD_AND_TEST.md', '/tests/characterization/run-baseline.mjs', '/.git/config', '/reference/Jogar-Trindade-transicao-preta.baseline.html', '/Jogar-Trindade-transicao-preta.html', '/config/gameplay.local.json']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, `${path} não pode ser publicado.`);
  }
  const traversal = await fetch(`${base}/%2e%2e%2fdocs/BUILD_AND_TEST.md`);
  assert.notEqual(traversal.status, 200);
  process.stdout.write('Web output smoke: 22 checks passed (allowlist, entry, module/style/config/assets 200, internals absent, traversal rejected).\n');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
