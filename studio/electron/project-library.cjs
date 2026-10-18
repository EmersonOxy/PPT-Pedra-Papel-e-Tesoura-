const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { allowedFiles, loadProjectAt } = require('./project-service.cjs');
const { compareVersions, parseVersion } = require('./update-service.cjs');

const PROJECT_MANIFEST = 'trindade.project.json';
const PROJECT_FORMAT_VERSION = 1;
const GAME_ENGINE_VERSION = '1.0.0';
const TEMPLATE_ID = 'pedra-papel-tesoura-web';
const SETTINGS_VERSION = 1;
const PROJECT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,49}$/u;
const TEMPLATES = Object.freeze([
  Object.freeze({
    id: TEMPLATE_ID,
    label: 'Pedra, Papel e Tesoura · jogo modular',
    description: 'Projeto web modular com a configuração visual do jogo atual.',
    version: '1.0.0',
    engineId: 'trindade-engine',
    available: true,
  }),
]);

function projectNameFromPath(value) {
  const cleaned = String(value).normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, ' ').trim().slice(0, 50);
  return PROJECT_NAME_PATTERN.test(cleaned) ? cleaned : 'Projeto importado';
}

function getTemplate(templateId) {
  return TEMPLATES.find((template) => template.id === templateId && template.available) || null;
}

function makeManifest(name, id = crypto.randomUUID(), now = new Date().toISOString(), templateId = TEMPLATE_ID) {
  const template = getTemplate(templateId);
  if (!template) throw new Error('O modelo de projeto não está disponível.');
  return {
    manifestVersion: 1,
    id,
    name,
    createdAt: now,
    projectFormatVersion: PROJECT_FORMAT_VERSION,
    engine: { id: 'trindade-engine', testedVersion: GAME_ENGINE_VERSION, minimumCompatibleVersion: '1.0.0' },
    template: { id: template.id, version: template.version },
  };
}

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O manifesto do projeto é inválido.');
  if (value.manifestVersion !== 1 || value.projectFormatVersion !== PROJECT_FORMAT_VERSION) {
    throw new Error('Este projeto foi criado em um formato mais novo ou incompatível. Atualize o Studio para abri-lo.');
  }
  if (typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.id)) throw new Error('O ID do projeto é inválido.');
  if (typeof value.name !== 'string' || !PROJECT_NAME_PATTERN.test(value.name)) throw new Error('O nome do projeto é inválido.');
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) throw new Error('A data do projeto é inválida.');
  if (value.engine?.id !== 'trindade-engine' || !parseVersion(value.engine.testedVersion) || !parseVersion(value.engine.minimumCompatibleVersion)) throw new Error('A compatibilidade declarada com a Trindade Engine é inválida.');
  if (compareVersions(value.engine.minimumCompatibleVersion, GAME_ENGINE_VERSION) > 0) throw new Error('Este projeto exige uma versão mais nova da Trindade Engine. Atualize o Studio antes de abrir o projeto.');
  const template = getTemplate(value.template?.id);
  if (!template || !parseVersion(value.template.version) || compareVersions(value.template.version, template.version) > 0) throw new Error('O modelo deste projeto não é compatível com esta versão do Studio.');
  return value;
}

async function canonicalDirectory(directory) {
  const info = await fs.lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Selecione uma pasta real do Windows.');
  return fs.realpath(directory);
}

async function atomicJsonWrite(file, value) {
  const temp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, file);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

async function readSettings(userData) {
  const file = path.join(userData, 'studio-settings.json');
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: SETTINGS_VERSION, recentProjects: [] };
    const projects = Array.isArray(value.recentProjects) ? value.recentProjects : [];
    const recentProjects = projects.filter((item) => item && typeof item.root === 'string' && typeof item.id === 'string')
      .slice(0, 20);
    if (!recentProjects.length && typeof value.lastProjectRoot === 'string') {
      recentProjects.push({ root: value.lastProjectRoot, id: '', name: path.basename(value.lastProjectRoot), lastOpenedAt: '' });
    }
    return { version: SETTINGS_VERSION, recentProjects };
  } catch {
    return { version: SETTINGS_VERSION, recentProjects: [] };
  }
}

async function writeSettings(userData, settings) {
  await fs.mkdir(userData, { recursive: true });
  await atomicJsonWrite(path.join(userData, 'studio-settings.json'), {
    version: SETTINGS_VERSION,
    recentProjects: settings.recentProjects.slice(0, 20),
  });
}

async function copyRuntimeFiles(sourceRoot, destinationRoot) {
  for (const relative of allowedFiles) {
    const source = path.resolve(sourceRoot, relative);
    const destination = path.resolve(destinationRoot, relative);
    if (!source.startsWith(path.resolve(sourceRoot) + path.sep) || !destination.startsWith(path.resolve(destinationRoot) + path.sep)) {
      throw new Error('O modelo contém um caminho fora da pasta do projeto.');
    }
    let cursor = path.resolve(sourceRoot);
    for (const segment of relative.split('/')) {
      cursor = path.join(cursor, segment);
      const info = await fs.lstat(cursor);
      if (info.isSymbolicLink()) throw new Error(`Links simbólicos não são aceitos no modelo: ${relative}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination, require('node:fs').constants.COPYFILE_EXCL);
  }
}

async function createProject({ name, parentDirectory, templateRoot, templateId = TEMPLATE_ID }) {
  if (typeof name !== 'string' || !PROJECT_NAME_PATTERN.test(name.trim())) throw new Error('Use um nome de até 50 letras, números, espaços, hífens ou sublinhados.');
  const template = getTemplate(templateId);
  if (!template) throw new Error('O modelo de projeto selecionado não está disponível neste Studio.');
  const safeName = name.trim();
  const parent = await canonicalDirectory(parentDirectory);
  const destination = path.resolve(parent, safeName);
  if (!destination.startsWith(parent + path.sep)) throw new Error('O nome do projeto aponta para fora da pasta escolhida.');
  await fs.mkdir(destination, { recursive: false });
  try {
    await copyRuntimeFiles(templateRoot, destination);
    const manifest = makeManifest(safeName, crypto.randomUUID(), new Date().toISOString(), templateId);
    await fs.writeFile(path.join(destination, PROJECT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { root: await fs.realpath(destination), manifest };
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

async function createDuplicate({ sourceRoot, parentDirectory, name, templateRoot, userData }) {
  const source = await canonicalDirectory(sourceRoot);
  const baseName = projectNameFromPath(name);
  let candidate = baseName;
  let suffix = 2;
  const parent = await canonicalDirectory(parentDirectory);
  while (true) {
    const destination = path.join(parent, candidate);
    try {
      await fs.access(destination);
      candidate = `${baseName.slice(0, 42)} - ${suffix++}`;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      break;
    }
  }
  const result = await createProject({ name: candidate, parentDirectory: parent, templateRoot, templateId: TEMPLATE_ID });
  try {
    // Replace the fresh template files with an allowlisted snapshot of the selected project.
    for (const relative of allowedFiles) {
      const sourceFile = path.join(source, relative);
      const destinationFile = path.join(result.root, relative);
      await fs.copyFile(sourceFile, destinationFile);
    }
    const manifest = { ...result.manifest, name: candidate };
    await atomicJsonWrite(path.join(result.root, PROJECT_MANIFEST), manifest);
    return { root: result.root, manifest };
  } catch (error) {
    await fs.rm(result.root, { recursive: true, force: true });
    throw error;
  }
}

async function makeImportBackup(projectRoot, userData) {
  const root = await canonicalDirectory(projectRoot);
  const backupRoot = path.join(userData, 'import-backups', `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
  await fs.mkdir(backupRoot, { recursive: true });
  for (const relative of allowedFiles) {
    const source = path.join(root, relative);
    let cursor = root;
    for (const segment of relative.split('/')) {
      cursor = path.join(cursor, segment);
      const info = await fs.lstat(cursor);
      if (info.isSymbolicLink()) throw new Error(`O projeto contém um link simbólico: ${relative}`);
    }
    const target = path.join(backupRoot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
  return backupRoot;
}

async function ensureManifest(projectRoot, { userData, confirmImport = false }) {
  const root = await canonicalDirectory(projectRoot);
  const manifestPath = path.join(root, PROJECT_MANIFEST);
  let raw;
  try { raw = await fs.readFile(manifestPath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (raw !== undefined) return validateManifest(JSON.parse(raw));
  if (!confirmImport) return null;
  const backupRoot = await makeImportBackup(root, userData);
  const manifest = makeManifest(projectNameFromPath(path.basename(root)));
  await fs.writeFile(manifestPath, `${JSON.stringify({ ...manifest, importBackup: path.basename(backupRoot) }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return manifest;
}

async function isGitWorkingTree(directory) {
  let cursor = await canonicalDirectory(directory);
  while (true) {
    const marker = path.join(cursor, '.git');
    try {
      const markerInfo = await fs.lstat(marker);
      if (markerInfo.isDirectory() || markerInfo.isFile() || markerInfo.isSymbolicLink()) return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
}

async function addRecentProject(userData, root, manifest, name) {
  const settings = await readSettings(userData);
  const recentProjects = settings.recentProjects.filter((item) => item.root !== root);
  recentProjects.unshift({ id: manifest.id, root, name, projectFormatVersion: PROJECT_FORMAT_VERSION, lastOpenedAt: new Date().toISOString() });
  await writeSettings(userData, { recentProjects });
  return recentProjects;
}

async function listRecentProjects(userData) {
  const settings = await readSettings(userData);
  const entries = [];
  for (const recent of settings.recentProjects) {
    try {
      const loaded = await loadProjectAt(recent.root);
      let manifest = null;
      try {
        manifest = validateManifest(JSON.parse(await fs.readFile(path.join(loaded.root, PROJECT_MANIFEST), 'utf8')));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      entries.push({
        id: manifest?.id || recent.id || '',
        name: manifest?.name || recent.name || loaded.name,
        root: loaded.root,
        projectFormatVersion: manifest?.projectFormatVersion || 1,
        lastOpenedAt: recent.lastOpenedAt,
        needsImport: !manifest,
      });
    } catch {
      // A missing/moved/incompatible project is retained as a visible stale entry, not silently opened.
      entries.push({ ...recent, unavailable: true });
    }
  }
  return entries;
}

async function removeRecentProject(userData, root) {
  const settings = await readSettings(userData);
  const recentProjects = settings.recentProjects.filter((item) => item.root !== root);
  await writeSettings(userData, { recentProjects });
  return recentProjects;
}

module.exports = {
  GAME_ENGINE_VERSION,
  PROJECT_FORMAT_VERSION,
  PROJECT_MANIFEST,
  PROJECT_NAME_PATTERN,
  TEMPLATE_ID,
  TEMPLATES,
  addRecentProject,
  createDuplicate,
  createProject,
  ensureManifest,
  getTemplate,
  isGitWorkingTree,
  listRecentProjects,
  makeManifest,
  readSettings,
  removeRecentProject,
  validateManifest,
  writeSettings,
};
