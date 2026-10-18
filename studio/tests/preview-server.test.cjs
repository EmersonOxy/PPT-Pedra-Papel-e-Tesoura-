const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPreviewServer } = require('../electron/preview-server.cjs');
const { allowedFiles } = require('../electron/project-service.cjs');

const projectRoot = path.resolve(__dirname, '..', '..');
const editorOrigin = 'http://127.0.0.1:45678';
const session = 'a'.repeat(64);

test('serves the actual modular runtime with a strict frame boundary and a session-bound bridge', async (t) => {
  const server = createPreviewServer(projectRoot, () => editorOrigin);
  const origin = await server.listen();
  t.after(() => server.close());

  const page = await fetch(`${origin}/?studioSession=${session}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  assert.match(page.headers.get('content-security-policy'), new RegExp(`frame-ancestors ${editorOrigin.replaceAll('.', '\\.')}`));
  const html = await page.text();
  assert.match(html, /type="module" src="\.\/src\/game\/main\.js"/);
  assert.match(html, /__studio\/preview-bridge\.js\?studioParent=http%3A/);

  for (const file of allowedFiles) {
    const query = file === 'index.html' ? `?studioSession=${session}` : '';
    const response = await fetch(`${origin}/${file}${query}`);
    assert.equal(response.status, 200, `${file} deve estar disponível à prévia local.`);
  }

  const validBridge = new URL(`${origin}/__studio/preview-bridge.js`);
  validBridge.searchParams.set('studioParent', editorOrigin);
  validBridge.searchParams.set('studioSession', session);
  const bridgeResponse = await fetch(validBridge);
  assert.equal(bridgeResponse.status, 200);
  const bridgeScript = await bridgeResponse.text();
  assert.match(bridgeScript, /ELEMENT_SELECTED/);
  assert.match(bridgeScript, /document\.currentScript\?\.src/);
  assert.match(bridgeScript, /message\.type === 'HELLO'/);

  const invalidBridge = new URL(validBridge);
  invalidBridge.searchParams.set('studioParent', 'https://attacker.invalid');
  assert.equal((await fetch(invalidBridge)).status, 404);
  assert.equal((await fetch(`${origin}/docs/BUILD_AND_TEST.md`)).status, 404);
  assert.equal((await fetch(`${origin}/.git/config`)).status, 404);
  assert.equal((await fetch(`${origin}/%2e%2e%2fAGENTS.md`)).status, 404);
  assert.equal((await fetch(`${origin}/`, { method: 'POST' })).status, 405);
});
