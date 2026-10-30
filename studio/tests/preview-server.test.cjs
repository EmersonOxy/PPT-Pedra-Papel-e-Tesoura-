const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPreviewServer } = require('../electron/preview-server.cjs');
const { allowedFiles, importImageAt } = require('../electron/project-service.cjs');
const { createContentSecurityPolicy } = require('../electron/renderer-server.cjs');

const projectRoot = path.resolve(__dirname, '..', '..', 'games', 'pedra-papel-tesoura');
const editorOrigin = 'http://127.0.0.1:45678';
let activeSession = 'a'.repeat(64);
const session = 'a'.repeat(64);

test('renderer CSP permits data thumbnails but no arbitrary origins', () => {
  const csp = createContentSecurityPolicy('http://127.0.0.1:4173');
  const imageDirective = csp.split(';').find((directive) => directive.trim().startsWith('img-src'));
  assert.equal(imageDirective?.trim(), "img-src 'self' data:");
});

test('serves the actual modular runtime with a strict frame boundary and a session-bound bridge', async (t) => {
  const server = createPreviewServer(projectRoot, () => editorOrigin, () => activeSession);
  const origin = await server.listen();
  t.after(() => server.close());

  const parent = encodeURIComponent(editorOrigin);
  const page = await fetch(`${origin}/?studioParent=${parent}&studioSession=${session}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  assert.match(page.headers.get('content-security-policy'), new RegExp(`frame-ancestors ${editorOrigin.replaceAll('.', '\\.')}`));
  const html = await page.text();
  assert.match(html, /type="module" src="\.\/src\/game\/main\.js"/);
  assert.match(html, /__studio\/preview-bridge\.js\?studioParent=http%3A/);

  for (const file of allowedFiles) {
    const query = file === 'index.html' ? `?studioParent=${parent}&studioSession=${session}` : '';
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

  const validScenes = new URL(`${origin}/__studio/scenes.json`);
  validScenes.searchParams.set('studioParent', editorOrigin);
  validScenes.searchParams.set('studioSession', session);
  const scenesResponse = await fetch(validScenes);
  assert.equal(scenesResponse.status, 200);
  const scenes = await scenesResponse.json();
  assert.equal(scenes.version, 1);
  assert.deepEqual(scenes.scenes.map((scene) => scene.id), ['menu', 'combat', 'battle-win', 'battle-loss', 'reward', 'match-win', 'match-loss', 'timeout-loss']);
  const missingScenesAuth = new URL(validScenes);
  missingScenesAuth.searchParams.set('studioParent', 'https://attacker.invalid');
  assert.equal((await fetch(missingScenesAuth)).status, 404);
  assert.equal((await fetch(`${origin}/__studio/scenes.json`)).status, 404);

  const invalidBridge = new URL(validBridge);
  invalidBridge.searchParams.set('studioParent', 'https://attacker.invalid');
  assert.equal((await fetch(invalidBridge)).status, 404);
  assert.equal((await fetch(`${origin}/docs/BUILD_AND_TEST.md`)).status, 404);
  assert.equal((await fetch(`${origin}/.git/config`)).status, 404);
  assert.equal((await fetch(`${origin}/%2e%2e%2fAGENTS.md`)).status, 404);
  assert.equal((await fetch(`${origin}/`)).status, 404, 'A rota da prévia exige sessão e origem ativas.');
  assert.equal((await fetch(`${origin}/?studioParent=${parent}&studioSession=${'b'.repeat(64)}`)).status, 404, 'Uma sessão de outro projeto deve ser recusada.');
  const staleBridge = new URL(validBridge);
  staleBridge.searchParams.set('studioSession', 'b'.repeat(64));
  assert.equal((await fetch(staleBridge)).status, 404, 'O bridge deve recusar uma sessão antiga.');
  const missingBridgeOrigin = new URL(validBridge);
  missingBridgeOrigin.searchParams.delete('studioParent');
  assert.equal((await fetch(missingBridgeOrigin)).status, 404, 'O bridge exige a origem exata do Studio.');
  assert.equal((await fetch(`${origin}/assets/manifest.json?studioSession=${session}`)).status, 404, 'A biblioteca exige a origem e a sessão ativas.');
  assert.equal((await fetch(`${origin}/assets/manifest.json?studioParent=${parent}&studioSession=${session}`)).status, 200, 'Projetos sem biblioteca continuam válidos com manifesto vazio.');
  assert.equal((await fetch(`${origin}/assets/imported/img_${'0'.repeat(32)}?studioParent=${parent}&studioSession=${session}`)).status, 404, 'Um asset não registrado não deve ser servido.');
  assert.equal((await fetch(`${origin}/`, { method: 'POST' })).status, 405);

  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trindade-preview-session-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const secondProject = path.join(temporary, 'second-project');
  await fs.mkdir(secondProject, { recursive: true });
  for (const relative of allowedFiles) {
    const source = path.join(projectRoot, relative);
    const destination = path.join(secondProject, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  const imported = await importImageAt(secondProject, path.join(projectRoot, 'assets/images/hand-rock.png'));
  server.setProjectRoot(secondProject);
  activeSession = 'c'.repeat(64);
  const oldProjectAssetUrl = `${origin}/assets/imported/${imported.asset.id}?studioParent=${parent}&studioSession=${session}`;
  assert.equal((await fetch(oldProjectAssetUrl)).status, 404, 'Uma sessão antiga não pode buscar assets de outro projeto.');
  const activeManifest = await fetch(`${origin}/assets/manifest.json?studioParent=${parent}&studioSession=${activeSession}`);
  assert.equal(activeManifest.status, 200);
  assert.equal((await activeManifest.json()).assets[0].id, imported.asset.id);
  const activeImage = await fetch(`${origin}/assets/imported/${imported.asset.id}?studioParent=${parent}&studioSession=${activeSession}`);
  assert.equal(activeImage.status, 200);
  assert.equal(activeImage.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await activeImage.arrayBuffer()).length, imported.asset.size);
  assert.equal((await fetch(`${origin}/assets/imported/${imported.asset.id}?studioParent=${parent}&studioSession=${'d'.repeat(64)}`)).status, 404);
});
