const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { allowedFiles, loadProjectAt, readAllowedFile, saveVisualConfigAt, validateVisualConfig } = require('../electron/project-service.cjs');
const { rectanglesOverlap } = require('../electron/geometry.cjs');

const repositoryRoot = path.resolve(__dirname, '..', '..');

async function makeProject(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'trindade-studio-project-'));
  const projectRoot = path.join(temp, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
  for (const relative of allowedFiles) {
    const source = path.join(repositoryRoot, relative);
    const destination = path.join(projectRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  const gameplaySource = path.join(repositoryRoot, 'config', 'gameplay.local.json');
  const gameplayPath = path.join(projectRoot, 'config', 'gameplay.local.json');
  await fs.copyFile(gameplaySource, gameplayPath);
  t.after(async () => fs.rm(temp, { recursive: true, force: true }));
  return { projectRoot, gameplayPath };
}

test('loads the modular project and all registered editable elements', async (t) => {
  const { projectRoot } = await makeProject(t);
  const project = await loadProjectAt(projectRoot);
  assert.equal(project.name, 'project');
  assert.equal(project.catalog.elements.length, 11);
  assert.equal(Object.keys(project.config.elements).length, 11);
  assert.equal(project.config.elements['game.title'].base.text, 'Pedra, papel e tesoura');
});

test('validates geometry limits, dimensions, breakpoints, and rejects arbitrary fields', async (t) => {
  const { projectRoot } = await makeProject(t);
  const { catalog, config } = await loadProjectAt(projectRoot);
  const invalidCases = [
    { base: { x: 10000 } },
    { base: { width: 10 } },
    { base: { height: 1000 } },
    { base: { script: 'alert(1)' } },
    { base: { x: NaN } },
    { responsive: { tablet: { width: 9000 } } },
    { responsive: { widescreen: { x: 0 } } },
  ];
  for (const geometry of invalidCases) {
    const candidate = structuredClone(config);
    candidate.elements['menu.card'].geometry = geometry;
    assert.throws(() => validateVisualConfig(catalog, candidate), /Geometria inválida/);
  }
  assert.equal(rectanglesOverlap({ left: 0, top: 0, right: 20, bottom: 20 }, { left: 10, top: 10, right: 30, bottom: 30 }), true);
  assert.equal(rectanglesOverlap({ left: 0, top: 0, right: 20, bottom: 20 }, { left: 20, top: 0, right: 40, bottom: 20 }), false);
  assert.equal(rectanglesOverlap({ left: 0, top: 0, right: 20, bottom: 20 }, { left: 1, top: 1, right: 10, bottom: 10 }), true);
});

test('opens legacy schema 1 projects without adding geometry or migrating files', async (t) => {
  const { projectRoot } = await makeProject(t);
  const catalogPath = path.join(projectRoot, 'config', 'editor-elements.schema.json');
  const configPath = path.join(projectRoot, 'config', 'visual.json');
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  catalog.version = 1;
  catalog.elements = catalog.elements.filter((element) => !['menu.card', 'menu.start'].includes(element.id));
  for (const element of catalog.elements) delete element.geometry;
  config.schemaVersion = 1;
  delete config.elements['menu.card'];
  delete config.elements['menu.start'];
  await fs.writeFile(catalogPath, JSON.stringify(catalog));
  await fs.writeFile(configPath, JSON.stringify(config));
  const before = await fs.readFile(configPath);
  const project = await loadProjectAt(projectRoot);
  assert.equal(project.catalog.version, 1);
  assert.equal(project.config.schemaVersion, 1);
  assert.equal(project.config.elements['game.title'].geometry, undefined);
  assert.deepEqual(await fs.readFile(configPath), before, 'Abrir projeto antigo não deve migrar arquivos silenciosamente.');
});

test('rejects paths outside the explicit runtime allowlist', async (t) => {
  const { projectRoot } = await makeProject(t);
  await assert.rejects(readAllowedFile(projectRoot, '../docs/BUILD_AND_TEST.md'), /não está disponível/);
  await assert.rejects(readAllowedFile(projectRoot, '.env'), /não está disponível/);
});

test('rejects missing project files without creating replacements', async (t) => {
  const { projectRoot } = await makeProject(t);
  await fs.unlink(path.join(projectRoot, 'config', 'visual.json'));
  await assert.rejects(loadProjectAt(projectRoot));
  await assert.rejects(fs.access(path.join(projectRoot, 'config', 'visual.json')));
});

test('rejects unknown elements, invalid colors, unregistered images, and future versions', async (t) => {
  const { projectRoot } = await makeProject(t);
  const { catalog, config } = await loadProjectAt(projectRoot);

  const unknownElement = structuredClone(config);
  unknownElement.elements['system.exec'] = { base: { command: 'echo unsafe' } };
  assert.throws(() => validateVisualConfig(catalog, unknownElement), /não registrado/);

  const invalidColor = structuredClone(config);
  invalidColor.elements['arena.background'].base.backgroundColor = 'url(javascript:alert(1))';
  assert.throws(() => validateVisualConfig(catalog, invalidColor), /Valor inválido/);

  const invalidAsset = structuredClone(config);
  invalidAsset.elements['hands.player.image'].base.assetId = '../../outside.png';
  assert.throws(() => validateVisualConfig(catalog, invalidAsset), /Valor inválido/);

  const future = structuredClone(config);
  future.schemaVersion = 900;
  assert.throws(() => validateVisualConfig(catalog, future), /versão ou formato incompatível/);
});

test('saves the versioned visual config with a recoverable previous copy and leaves gameplay alone', async (t) => {
  const { projectRoot, gameplayPath } = await makeProject(t);
  const { catalog, config } = await loadProjectAt(projectRoot);
  const configPath = path.join(projectRoot, 'config', 'visual.json');
  const oldConfig = await fs.readFile(configPath);
  const oldGameplay = await fs.readFile(gameplayPath);
  const updated = structuredClone(config);
  updated.elements['game.title'].base.text = 'Meu título visual';

  const result = await saveVisualConfigAt(projectRoot, catalog, updated);
  const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(saved.elements['game.title'].base.text, 'Meu título visual');
  assert.deepEqual(await fs.readFile(result.backupPath), oldConfig);
  assert.deepEqual(await fs.readFile(gameplayPath), oldGameplay);
});

test('preserves the current config if atomic save is interrupted', async (t) => {
  const { projectRoot } = await makeProject(t);
  const { catalog, config } = await loadProjectAt(projectRoot);
  const configPath = path.join(projectRoot, 'config', 'visual.json');
  const oldConfig = await fs.readFile(configPath);
  const updated = structuredClone(config);
  updated.elements['game.title'].base.text = 'Não deve ser gravado';

  await assert.rejects(saveVisualConfigAt(projectRoot, catalog, updated, {
    beforeReplace: async () => { throw new Error('interrupção simulada'); },
  }), /versão anterior foi preservada/);
  assert.deepEqual(await fs.readFile(configPath), oldConfig);
  assert.deepEqual(await fs.readFile(`${configPath}.bak`), oldConfig);
  assert.deepEqual((await fs.readdir(path.dirname(configPath))).filter((name) => name.endsWith('.tmp')), []);
});

test('refuses a symlink for the writable visual configuration', async (t) => {
  const { projectRoot } = await makeProject(t);
  const configPath = path.join(projectRoot, 'config', 'visual.json');
  const outsidePath = path.join(path.dirname(projectRoot), 'outside-visual.json');
  await fs.copyFile(configPath, outsidePath);
  await fs.unlink(configPath);
  try {
    await fs.symlink(outsidePath, configPath, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) return t.skip('A conta Windows não pode criar links simbólicos neste ambiente.');
    throw error;
  }
  const { catalog, config } = await loadProjectAt(projectRoot).catch(async () => {
    await fs.unlink(configPath);
    await fs.copyFile(outsidePath, configPath);
    return loadProjectAt(projectRoot);
  });
  await fs.unlink(configPath);
  await fs.symlink(outsidePath, configPath, 'file');
  await assert.rejects(saveVisualConfigAt(projectRoot, catalog, config), /arquivo local seguro/);
});
