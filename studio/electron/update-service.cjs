const STABLE_RELEASES_URL = 'https://api.github.com/repos/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases/latest';
const STABLE_RELEASE_PAGE = 'https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases';

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || '' };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('A versão do Studio não segue SemVer.');
  for (const field of ['major', 'minor', 'patch']) if (a[field] !== b[field]) return Math.sign(a[field] - b[field]);
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease === b.prerelease) return 0;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function validateRelease(release) {
  if (!release || typeof release !== 'object' || release.draft !== false || release.prerelease !== false) {
    throw new Error('A resposta não é uma release estável publicada.');
  }
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!parseVersion(version) || parseVersion(version).prerelease) throw new Error('A release publicada tem uma versão inválida ou não estável.');
  const expectedPage = `https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases/tag/${release.tag_name}`;
  if (release.html_url !== expectedPage) throw new Error('A origem da release não corresponde ao repositório oficial.');
  const body = typeof release.body === 'string' ? release.body.slice(0, 12000) : '';
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const installer = assets.find((asset) => asset.name === `Trindade-Studio-Setup-${version}.exe`
    && typeof asset.browser_download_url === 'string'
    && asset.browser_download_url.startsWith('https://github.com/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases/download/'));
  if (!installer) throw new Error('A release estável não contém o instalador NSIS esperado.');
  return { version, notes: body, pageUrl: expectedPage, installerName: installer.name, publishedAt: release.published_at || null };
}

function createUpdateService({ fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  return {
    async check(currentVersion) {
      if (!parseVersion(currentVersion)) return { state: 'error', currentVersion, message: 'A versão instalada não segue SemVer.' };
      try {
        const response = await fetchImpl(STABLE_RELEASES_URL, {
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(response.status === 404 ? 'Ainda não há uma release estável com instalador.' : `GitHub respondeu HTTP ${response.status}.`);
        const release = validateRelease(await response.json());
        const comparison = compareVersions(release.version, currentVersion);
        if (comparison === 0) return { state: 'up-to-date', currentVersion, latestVersion: release.version, ...release };
        if (comparison < 0) return { state: 'local-ahead', currentVersion, latestVersion: release.version, ...release };
        return { state: 'available', currentVersion, latestVersion: release.version, ...release };
      } catch (error) {
        const offline = error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED' || error?.code === 'EAI_AGAIN';
        return { state: offline ? 'offline' : 'error', currentVersion, message: offline ? 'Não foi possível conectar agora. O Studio continua funcionando offline.' : error.message };
      }
    },
  };
}

function isOfficialReleasePage(url) {
  try {
    const parsed = new URL(url);
    const releasesPath = '/EmersonOxy/PPT-Pedra-Papel-e-Tesoura-/releases';
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
      && (parsed.pathname === releasesPath || parsed.pathname.startsWith(`${releasesPath}/`));
  } catch { return false; }
}

module.exports = { STABLE_RELEASE_PAGE, STABLE_RELEASES_URL, compareVersions, createUpdateService, isOfficialReleasePage, parseVersion, validateRelease };
