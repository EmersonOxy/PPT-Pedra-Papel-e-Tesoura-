const test = require('node:test');
const assert = require('node:assert/strict');
const { STABLE_RELEASES_URL, compareVersions, createUpdateService, isOfficialReleasePage, parseVersion, validateRelease } = require('../electron/update-service.cjs');

function release(version = '0.2.0', overrides = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    body: 'Novidades de teste',
    html_url: `https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases/tag/v${version}`,
    published_at: '2026-10-01T12:00:00Z',
    assets: [{
      name: `Trindade-Studio-Setup-${version}.exe`,
      browser_download_url: `https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases/download/v${version}/Trindade-Studio-Setup-${version}.exe`,
    }],
    ...overrides,
  };
}

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

test('compares stable semantic versions and orders prereleases before releases', () => {
  assert.equal(parseVersion('0.2.0').major, 0);
  assert.equal(parseVersion('v1.0.0-rc.1').prerelease, 'rc.1');
  assert.equal(parseVersion('latest'), null);
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-rc.10', '1.0.0-rc.2'), 1);
});

test('offers only a newer stable release from the official repository', async () => {
  let requested;
  const updater = createUpdateService({ fetchImpl: async (url, options) => { requested = { url, options }; return response(release()); } });
  const result = await updater.check('0.1.0');
  assert.equal(requested.url, STABLE_RELEASES_URL);
  assert.equal(requested.options.headers.Accept, 'application/vnd.github+json');
  assert.equal(result.state, 'available');
  assert.equal(result.latestVersion, '0.2.0');
  assert.equal(result.installerName, 'Trindade-Studio-Setup-0.2.0.exe');
  assert.equal(result.pageUrl, release().html_url);
});

test('reports up-to-date when release matches or would downgrade the installed app', async () => {
  const updater = createUpdateService({ fetchImpl: async () => response(release('0.1.0')) });
  assert.equal((await updater.check('0.1.0')).state, 'up-to-date');
  assert.equal((await updater.check('0.2.0')).state, 'local-ahead');
});

test('rejects prereleases, drafts, malformed version tags, foreign release pages and missing installer assets', async () => {
  assert.throws(() => validateRelease(release('0.2.0-rc.1', { prerelease: true })), /estável/);
  assert.throws(() => validateRelease(release('0.2.0', { draft: true })), /estável/);
  assert.throws(() => validateRelease(release('release-latest')), /versão inválida/);
  assert.throws(() => validateRelease(release('0.2.0', { html_url: 'https://evil.example/releases/tag/v0.2.0' })), /repositório oficial/);
  assert.throws(() => validateRelease(release('0.2.0', { assets: [] })), /instalador NSIS esperado/);
});

test('distinguishes offline and service errors without attempting a download or install', async () => {
  const offline = createUpdateService({ fetchImpl: async () => { const error = new Error('offline'); error.name = 'AbortError'; throw error; } });
  const error = createUpdateService({ fetchImpl: async () => response({}, 503) });
  assert.equal((await offline.check('0.2.0')).state, 'offline');
  assert.equal((await error.check('0.2.0')).state, 'error');
  assert.equal((await error.check('nightly')).state, 'error');
});

test('opens no URL outside the official HTTPS releases pages', () => {
  assert.equal(isOfficialReleasePage('https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases/tag/v0.2.0'), true);
  assert.equal(isOfficialReleasePage('https://github.com/other/project/releases'), false);
  assert.equal(isOfficialReleasePage('http://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases'), false);
  assert.equal(isOfficialReleasePage('https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases-impersonation'), false);
  assert.equal(isOfficialReleasePage('javascript:alert(1)'), false);
});
