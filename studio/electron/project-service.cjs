const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateGeometry } = require('./geometry.cjs');
const { importImageAt, readAssetManifestAt, readRegisteredAssetAt } = require('./asset-service.cjs');

const allowedFiles = new Set([
  'index.html',
  'config/editor-elements.schema.json',
  'config/visual.json',
  'assets/styles/game.css',
  'assets/images/hand-rock.png',
  'assets/images/hand-paper.png',
  'assets/images/hand-scissors.png',
  'src/game/main.js',
  'src/game/core/rules.js',
  'src/game/ui/game-animations.js',
  'src/game/ui/game-ui.js',
  'src/game/ui/game-view.js',
  'src/game/ui/turn-clock.js',
  'src/game/ui/visual-config.js',
]);

const assetIds = new Set(['hands.rock', 'hands.paper', 'hands.scissors']);
const colorPattern = /^#[0-9a-f]{6}$/i;
const idPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const breakpoints = new Set(['mobile', 'tablet']);
const propertyTypes = new Set(['text', 'color', 'imageAsset', 'fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'opacity', 'boolean']);
const elementKinds = new Set(['text', 'image', 'container', 'button', 'meter']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateValue(property, value, permittedAssetIds = assetIds) {
  if (property.type === 'text') {
    return typeof value === 'string' && value.length <= (property.maxLength || 80);
  }
  if (property.type === 'color') return typeof value === 'string' && colorPattern.test(value);
  if (property.type === 'imageAsset') return typeof value === 'string' && permittedAssetIds.has(value);
  if (property.type === 'fontFamily' || property.type === 'textAlign') return typeof value === 'string' && property.options?.includes(value) === true;
  if (property.type === 'fontSize' || property.type === 'opacity') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < property.min || value > property.max) return false;
    const step = property.step || 1;
    return Math.abs((value - property.min) / step - Math.round((value - property.min) / step)) < 1e-7;
  }
  if (property.type === 'fontWeight') return typeof value === 'number' && property.options?.includes(value) === true;
  if (property.type === 'boolean') return typeof value === 'boolean';
  return false;
}

function validateBinding(property) {
  const binding = property.binding;
  if (!isRecord(binding)) return false;
  if (binding.operation === 'textContent') return property.type === 'text' && Object.keys(binding).length === 1;
  if (binding.operation === 'styleVariable') {
    const supported = new Map([
      ['--arena-background', 'color'], ['--move-button-background', 'color'],
      ['--studio-background-color', 'color'], ['--studio-text-color', 'color'],
      ['--studio-font-family', 'fontFamily'], ['--studio-font-size', 'fontSize'],
      ['--studio-font-weight', 'fontWeight'], ['--studio-text-align', 'textAlign'], ['--studio-opacity', 'opacity'],
    ]);
    return Object.keys(binding).length === 2 && supported.get(binding.name) === property.type;
  }
  if (binding.operation === 'firstChildBackground') return property.type === 'color' && Object.keys(binding).length === 1;
  if (binding.operation === 'imageSource') return property.type === 'imageAsset' && Object.keys(binding).length === 1;
  if (binding.operation === 'visibility') return property.type === 'boolean' && Object.keys(binding).length === 1;
  return false;
}

function validateCatalog(catalog, html) {
  if (!isRecord(catalog) || ![1, 2, 3].includes(catalog.version) || !Array.isArray(catalog.elements) || catalog.elements.length === 0) {
    throw new Error('O catálogo de elementos não corresponde à versão suportada pelo Studio.');
  }
  const elements = new Map();
  for (const element of catalog.elements) {
    if (!isRecord(element) || typeof element.id !== 'string' || !idPattern.test(element.id) || elements.has(element.id)) {
      throw new Error('O catálogo contém um ID ausente, inválido ou duplicado.');
    }
    if (!elementKinds.has(element.kind) || typeof element.labelKey !== 'string' || element.labelKey.length === 0) {
      throw new Error(`A definição do elemento ${element.id} está incompleta.`);
    }
    if (element.target?.attribute !== 'data-editor-id' || !html.includes(`data-editor-id="${element.id}"`)) {
      throw new Error(`O elemento ${element.id} não tem um alvo real no jogo.`);
    }
    if (!Array.isArray(element.properties) || (element.properties.length === 0 && !(catalog.version >= 2 && element.geometry))) {
      throw new Error(`O elemento ${element.id} não tem propriedades editáveis registradas.`);
    }
    if (element.geometry) {
      const geometry = element.geometry;
      const fields = ['x', 'y', 'width', 'height'];
      if (catalog.version < 2 || geometry.type !== 'flow-box-v1' || geometry.binding !== 'css-flow-box-v1' || geometry.anchor !== 'flow'
        || geometry.units !== 'css-px' || typeof geometry.responsive !== 'boolean'
        || !Array.isArray(geometry.supports) || geometry.supports.length === 0
        || geometry.supports.some((capability) => !['move', 'resize'].includes(capability))
        || !isRecord(geometry.default) || Object.keys(geometry.default).some((field) => !fields.includes(field))
        || !isRecord(geometry.limits) || fields.some((field) => !isRecord(geometry.limits[field])
          || !Number.isFinite(geometry.limits[field].min) || !Number.isFinite(geometry.limits[field].max)
          || geometry.limits[field].min > geometry.limits[field].max)) {
        throw new Error(`A geometria do elemento ${element.id} não usa um binding permitido.`);
      }
      validateGeometry(geometry, { base: geometry.default });
    }
    const keys = new Set();
    for (const property of element.properties) {
      if (!isRecord(property) || typeof property.key !== 'string' || keys.has(property.key) || !propertyTypes.has(property.type)) {
        throw new Error(`A propriedade do elemento ${element.id} é inválida.`);
      }
      if (property.type === 'text' && (!Number.isInteger(property.maxLength) || property.maxLength < 1 || property.maxLength > 80)) {
        throw new Error(`O limite de texto da propriedade ${element.id}.${property.key} é inválido.`);
      }
      if ((property.type === 'fontFamily' || property.type === 'textAlign' || property.type === 'fontWeight')
        && (!Array.isArray(property.options) || property.options.length === 0 || !property.options.includes(property.default))) {
        throw new Error(`As opções da propriedade ${element.id}.${property.key} são inválidas.`);
      }
      if ((property.type === 'fontSize' || property.type === 'opacity')
        && (!Number.isFinite(property.min) || !Number.isFinite(property.max) || property.min > property.max
          || !Number.isFinite(property.step) || property.step <= 0 || property.default < property.min || property.default > property.max)) {
        throw new Error(`Os limites da propriedade ${element.id}.${property.key} são inválidos.`);
      }
      if (property.optional !== undefined && typeof property.optional !== 'boolean') throw new Error(`A opcionalidade da propriedade ${element.id}.${property.key} é inválida.`);
      if (!validateBinding(property) || !validateValue(property, property.default)) {
        throw new Error(`A propriedade ${element.id}.${property.key} tem vínculo ou default inválido.`);
      }
      keys.add(property.key);
    }
    elements.set(element.id, element);
  }
  return elements;
}

function validateVisualConfig(catalog, config, registeredAssetIds = []) {
  if (!isRecord(config) || config.schemaVersion !== catalog?.version || !isRecord(config.elements)) {
    throw new Error('A configuração visual tem uma versão ou formato incompatível.');
  }
  const definitions = new Map(catalog.elements.map((element) => [element.id, element]));
  const permittedAssetIds = new Set([...assetIds, ...registeredAssetIds]);
  for (const [id, entry] of Object.entries(config.elements)) {
    const definition = definitions.get(id);
    if (!definition || !isRecord(entry) || Object.keys(entry).some((key) => !['base', 'responsive', ...(catalog.version >= 2 ? ['geometry'] : [])].includes(key))) {
      throw new Error(`A configuração contém um elemento não registrado: ${id}`);
    }
    if (entry.base !== undefined && !isRecord(entry.base)) throw new Error(`Propriedades base inválidas em ${id}.`);
    const properties = new Map(definition.properties.map((property) => [property.key, property]));
    for (const [key, value] of Object.entries(entry.base || {})) {
      const property = properties.get(key);
      if (!property || !validateBinding(property) || !validateValue(property, value, permittedAssetIds)) {
        throw new Error(`Valor inválido em ${id}.${key}.`);
      }
    }
    if (entry.responsive !== undefined && !isRecord(entry.responsive)) throw new Error(`Overrides responsivos inválidos em ${id}.`);
    for (const [breakpoint, values] of Object.entries(entry.responsive || {})) {
      if (!breakpoints.has(breakpoint) || !isRecord(values)) throw new Error(`Breakpoint inválido em ${id}.`);
      for (const [key, value] of Object.entries(values)) {
        const property = properties.get(key);
        if (!property?.responsive || !validateBinding(property) || !validateValue(property, value, permittedAssetIds)) {
          throw new Error(`Valor responsivo inválido em ${id}.${key}.`);
        }
      }
    }
    if (entry.geometry !== undefined) {
      if (!definition.geometry) throw new Error(`Geometria não registrada para ${id}.`);
      try { validateGeometry(definition.geometry, entry.geometry); }
      catch (error) { throw new Error(`Geometria inválida em ${id}: ${error.message}`); }
    }
  }
  return config;
}

function completeConfig(catalog, config) {
  const elements = {};
  for (const definition of catalog.elements) {
    const existing = config.elements[definition.id];
    const base = {};
    for (const property of definition.properties) {
      if (Object.hasOwn(existing?.base || {}, property.key)) base[property.key] = existing.base[property.key];
      else if (!property.optional) base[property.key] = property.default;
    }
    elements[definition.id] = { base };
    if (existing?.responsive && Object.keys(existing.responsive).length > 0) elements[definition.id].responsive = existing.responsive;
    if (definition.geometry && existing?.geometry) elements[definition.id].geometry = existing.geometry;
  }
  return { schemaVersion: catalog.version, elements };
}

async function readAllowedFile(root, relativePath) {
  if (!allowedFiles.has(relativePath)) throw new Error('O arquivo solicitado não está disponível para o Studio.');
  const normalizedRoot = await fs.realpath(root);
  const segments = relativePath.split('/');
  let cursor = normalizedRoot;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const info = await fs.lstat(cursor);
    if (info.isSymbolicLink()) throw new Error(`Links simbólicos não são aceitos no projeto: ${relativePath}`);
  }
  const resolved = await fs.realpath(cursor);
  if (!resolved.startsWith(normalizedRoot + path.sep)) throw new Error('O caminho do projeto escapou da pasta aberta.');
  if (!(await fs.stat(resolved)).isFile()) throw new Error(`Arquivo obrigatório ausente: ${relativePath}`);
  return fs.readFile(resolved);
}

async function loadProjectAt(root) {
  const normalizedRoot = await fs.realpath(root);
  const rootInfo = await fs.lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Selecione uma pasta de projeto real.');
  const html = (await readAllowedFile(normalizedRoot, 'index.html')).toString('utf8');
  const catalog = JSON.parse((await readAllowedFile(normalizedRoot, 'config/editor-elements.schema.json')).toString('utf8'));
  const rawConfig = JSON.parse((await readAllowedFile(normalizedRoot, 'config/visual.json')).toString('utf8'));
  const assets = await readAssetManifestAt(normalizedRoot);
  validateCatalog(catalog, html);
  validateVisualConfig(catalog, rawConfig, assets.map((asset) => asset.id));
  return {
    root: normalizedRoot,
    name: path.basename(normalizedRoot),
    catalog,
    config: completeConfig(catalog, rawConfig),
    assets,
  };
}

async function writeSynced(filePath, contents) {
  const handle = await fs.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function saveVisualConfigAt(root, catalog, candidate, options = {}) {
  const normalizedRoot = await fs.realpath(root);
  const registeredAssets = await readAssetManifestAt(normalizedRoot);
  validateVisualConfig(catalog, candidate, registeredAssets.map((asset) => asset.id));
  const config = completeConfig(catalog, candidate);
  const configDirectory = path.join(normalizedRoot, 'config');
  const directoryInfo = await fs.lstat(configDirectory);
  const resolvedDirectory = await fs.realpath(configDirectory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory() || !resolvedDirectory.startsWith(normalizedRoot + path.sep)) {
    throw new Error('A pasta de configuração não é uma pasta local segura.');
  }
  const configPath = path.join(resolvedDirectory, 'visual.json');
  const configInfo = await fs.lstat(configPath);
  if (configInfo.isSymbolicLink() || !configInfo.isFile()) throw new Error('O arquivo de configuração não é um arquivo local seguro.');
  const backupPath = `${configPath}.bak`;
  const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const tempPath = `${configPath}.${token}.tmp`;
  const backupTempPath = `${backupPath}.${token}.tmp`;
  const operations = options.operations || fs;
  const oldBytes = await operations.readFile(configPath);
  let backupReady = false;
  try {
    await writeSynced(backupTempPath, oldBytes);
    await operations.rename(backupTempPath, backupPath);
    backupReady = true;
    await writeSynced(tempPath, `${JSON.stringify(config, null, 2)}\n`);
    if (options.beforeReplace) await options.beforeReplace();
    await operations.rename(tempPath, configPath);
    return { config, backupPath };
  } catch (error) {
    await operations.unlink(tempPath).catch(() => {});
    await operations.unlink(backupTempPath).catch(() => {});
    try {
      await operations.access(configPath);
    } catch {
      if (backupReady) await operations.copyFile(backupPath, configPath).catch(() => {});
    }
    throw new Error(`Não foi possível salvar a configuração visual. A versão anterior foi preservada. ${error.message}`);
  }
}

module.exports = {
  allowedFiles,
  completeConfig,
  loadProjectAt,
  importImageAt,
  readAllowedFile,
  readAssetManifestAt,
  readRegisteredAssetAt,
  saveVisualConfigAt,
  validateCatalog,
  validateVisualConfig,
};
