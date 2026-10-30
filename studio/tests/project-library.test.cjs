const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { allowedFiles } = require('../electron/project-service.cjs');
const { importImageAt, readAssetManifestAt } = require('../electron/asset-service.cjs');
const {
  PROJECT_MANIFEST,
  addRecentProject,
  createDuplicate,
  createProject,
  ensureManifest,
  isGitWorkingTree,
  listRecentProjects,
  makeManifest,
  removeRecentProject,
  validateManifest,
} = require('../electron/project-library.cjs');

const repositoryRoot = path.resolve(__dirname, '..', '..');

async function makeSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trindade-project-library-'));
  const template = path.join(root, 'template');
  const projects = path.join(root, 'projects');
  const userData = path.join(root, 'profile');
  await fs.mkdir(projects);
  await fs.mkdir(userData);
  for (const relative of allowedFiles) {
    const source = path.join(repositoryRoot, relative);
    const destination = path.join(template, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, template, projects, userData };
}

test('creates an independent named project with a versioned manifest and only runtime allowlist files', async (t) => {
  const sandbox = await makeSandbox(t);
  const result = await createProject({ name: 'Jogo de Teste', parentDirectory: sandbox.projects, templateRoot: sandbox.template });
  assert.equal(result.manifest.manifestVersion, 1);
  assert.equal(result.manifest.projectFormatVersion, 1);
  assert.equal(result.manifest.engine.id, 'trindade-engine');
  assert.equal(result.manifest.template.id, 'pedra-papel-tesoura-web');
  assert.equal(validateManifest(JSON.parse(await fs.readFile(path.join(result.root, PROJECT_MANIFEST), 'utf8'))).id, result.manifest.id);
  const files = [];
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else files.push(relative);
    }
  }
  await walk(result.root);
  assert.deepEqual(new Set(files), new Set([...allowedFiles, PROJECT_MANIFEST]));
  await assert.rejects(createProject({ name: 'Jogo de Teste', parentDirectory: sandbox.projects, templateRoot: sandbox.template }), { code: 'EEXIST' });
  assert.equal((await fs.readdir(sandbox.projects)).length, 1, 'A criação não pode sobrescrever nem duplicar silenciosamente a pasta existente.');
});

test('imports a legacy project only after confirmation and keeps a full allowlisted backup outside the project', async (t) => {
  const sandbox = await makeSandbox(t);
  const projectRoot = path.join(sandbox.projects, 'Projeto legado');
  await fs.cp(sandbox.template, projectRoot, { recursive: true });
  assert.equal(await ensureManifest(projectRoot, { userData: sandbox.userData }), null);
  await assert.rejects(fs.access(path.join(projectRoot, PROJECT_MANIFEST)));
  const manifest = await ensureManifest(projectRoot, { userData: sandbox.userData, confirmImport: true });
  assert.equal(manifest.projectFormatVersion, 1);
  const backupRoot = path.join(sandbox.userData, 'import-backups');
  const backupDirectories = await fs.readdir(backupRoot);
  assert.equal(backupDirectories.length, 1);
  for (const relative of allowedFiles) {
    assert.deepEqual(await fs.readFile(path.join(projectRoot, relative)), await fs.readFile(path.join(backupRoot, backupDirectories[0], relative)));
  }
  assert.equal((await fs.readdir(projectRoot)).includes(PROJECT_MANIFEST), true);
});

test('tracks recent projects in user data and removal never deletes the project files', async (t) => {
  const sandbox = await makeSandbox(t);
  const project = await createProject({ name: 'Projeto recente', parentDirectory: sandbox.projects, templateRoot: sandbox.template });
  await addRecentProject(sandbox.userData, project.root, project.manifest, 'Projeto recente');
  const recent = await listRecentProjects(sandbox.userData);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].root, project.root);
  assert.equal(recent[0].unavailable, undefined);
  await removeRecentProject(sandbox.userData, project.root);
  assert.equal((await listRecentProjects(sandbox.userData)).length, 0);
  await fs.access(path.join(project.root, 'index.html'));
});

test('detects Git repositories and worktrees by marker without running shell commands', async (t) => {
  const sandbox = await makeSandbox(t);
  const repository = path.join(sandbox.projects, 'repo');
  const worktree = path.join(repository, 'worktree');
  await fs.mkdir(worktree, { recursive: true });
  await fs.writeFile(path.join(repository, '.git'), 'gitdir: .git/worktrees/worktree\n');
  assert.equal(await isGitWorkingTree(worktree), true);
  assert.equal(await isGitWorkingTree(sandbox.projects), false);
});

test('rejects unsupported project and engine compatibility versions', () => {
  const futureFormat = makeManifest('Jogo');
  futureFormat.projectFormatVersion = 99;
  assert.throws(() => validateManifest(futureFormat), /incompatível/);
  const wrongEngine = makeManifest('Jogo');
  wrongEngine.engine.id = 'outra-engine';
  assert.throws(() => validateManifest(wrongEngine), /compatibilidade/);
  const newerMinimum = makeManifest('Jogo');
  newerMinimum.engine.minimumCompatibleVersion = '2.0.0';
  assert.throws(() => validateManifest(newerMinimum), /versão mais nova da Trindade Engine/);
  const invalidEngineVersion = makeManifest('Jogo');
  invalidEngineVersion.engine.testedVersion = 'versão desconhecida';
  assert.throws(() => validateManifest(invalidEngineVersion), /compatibilidade/);
  const futureTemplate = makeManifest('Jogo');
  futureTemplate.template.version = '2.0.0';
  assert.throws(() => validateManifest(futureTemplate), /modelo deste projeto/);
});

test('duplicates a selected project into a separate folder without copying repository metadata', async (t) => {
  const sandbox = await makeSandbox(t);
  const source = await createProject({ name: 'Projeto fonte', parentDirectory: sandbox.projects, templateRoot: sandbox.template });
  const imageSource = path.join(sandbox.root, 'imagem.png');
  await fs.copyFile(path.join(repositoryRoot, 'assets/images/hand-paper.png'), imageSource);
  const imported = await importImageAt(source.root, imageSource);
  await fs.mkdir(path.join(source.root, '.git'));
  const duplicate = await createDuplicate({ sourceRoot: source.root, parentDirectory: sandbox.projects, name: 'Projeto fonte', templateRoot: sandbox.template, userData: sandbox.userData });
  assert.notEqual(duplicate.manifest.id, source.manifest.id);
  assert.equal(await fs.readFile(path.join(duplicate.root, 'index.html'), 'utf8'), await fs.readFile(path.join(source.root, 'index.html'), 'utf8'));
  assert.deepEqual(await readAssetManifestAt(duplicate.root), imported.assets, 'A duplicação deve copiar a biblioteca validada do projeto.');
  assert.deepEqual(await fs.readFile(path.join(duplicate.root, imported.asset.file)), await fs.readFile(path.join(source.root, imported.asset.file)));
  assert.notEqual(await fs.stat(path.join(duplicate.root, imported.asset.file)).then((info) => info.ino), await fs.stat(path.join(source.root, imported.asset.file)).then((info) => info.ino), 'A cópia deve ter arquivo independente.');
  await assert.rejects(fs.access(path.join(duplicate.root, '.git')));
});
