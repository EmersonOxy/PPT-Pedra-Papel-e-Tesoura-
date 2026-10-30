const catalogUrl = new URL('../../../config/editor-elements.schema.json', import.meta.url);
const visualUrl = new URL('../../../config/visual.json', import.meta.url);
const builtInAssetPaths = Object.freeze({
  'hands.rock': './assets/images/hand-rock.png',
  'hands.paper': './assets/images/hand-paper.png',
  'hands.scissors': './assets/images/hand-scissors.png',
});
let assetPaths = { ...builtInAssetPaths };
const colorPattern = /^#[0-9a-f]{6}$/i;
const breakpoints = Object.freeze({
  mobile: '(max-width: 600px)',
  tablet: '(min-width: 601px) and (max-width: 750px)',
});
const styleVariableTypes = Object.freeze({
  '--arena-background': 'color', '--move-button-background': 'color',
  '--studio-background-color': 'color', '--studio-text-color': 'color',
  '--studio-font-family': 'fontFamily', '--studio-font-size': 'fontSize',
  '--studio-font-weight': 'fontWeight', '--studio-text-align': 'textAlign', '--studio-opacity': 'opacity',
});
const propertyBaselines = new WeakMap();
const appliedProperties = new WeakMap();

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidValue(property, value) {
  const { type } = property;
  if (type === 'text') return typeof value === 'string' && value.length <= Math.min(80, property.maxLength || 80);
  if (type === 'color') return typeof value === 'string' && colorPattern.test(value);
  if (type === 'imageAsset') return typeof value === 'string' && Object.hasOwn(assetPaths, value);
  if (type === 'fontFamily' || type === 'textAlign') return typeof value === 'string' && property.options?.includes(value) === true;
  if (type === 'fontWeight') return typeof value === 'number' && property.options?.includes(value) === true;
  if (type === 'fontSize' || type === 'opacity') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < property.min || value > property.max) return false;
    const step = property.step || 1;
    return Math.abs((value - property.min) / step - Math.round((value - property.min) / step)) < 1e-7;
  }
  if (type === 'boolean') return typeof value === 'boolean';
  return false;
}

function isValidBinding(property) {
  const binding = property?.binding;
  if (!binding || typeof binding !== 'object') return false;
  if (binding.operation === 'textContent') return property.type === 'text' && Object.keys(binding).length === 1;
  if (binding.operation === 'styleVariable') return Object.keys(binding).length === 2 && styleVariableTypes[binding.name] === property.type;
  if (binding.operation === 'firstChildBackground') return property.type === 'color' && Object.keys(binding).length === 1;
  if (binding.operation === 'imageSource') return property.type === 'imageAsset' && Object.keys(binding).length === 1;
  if (binding.operation === 'visibility') return property.type === 'boolean' && Object.keys(binding).length === 1;
  return false;
}

export function validateConfig(catalog, config) {
  if (![1, 2, 3].includes(catalog?.version) || config?.schemaVersion !== catalog.version || !config.elements || typeof config.elements !== 'object') {
    throw new Error('Versão ou formato da configuração visual não reconhecido.');
  }

  if (!Array.isArray(catalog.elements)) throw new Error('Catálogo de elementos inválido.');
  const catalogElements = new Map();
  for (const element of catalog.elements) {
    if (!element || typeof element.id !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(element.id) || catalogElements.has(element.id)) {
      throw new Error('ID de elemento ausente, inválido ou duplicado.');
    }
    if (!Array.isArray(element.properties)) throw new Error(`Lista de propriedades inválida em ${element.id}.`);
    for (const property of element.properties) {
      if (!property || typeof property.key !== 'string' || !isValidBinding(property) || !isValidValue(property, property.default)) throw new Error(`Propriedade registrada inválida em ${element.id}.`);
      if (['fontFamily', 'fontWeight', 'textAlign'].includes(property.type)
        && (!Array.isArray(property.options) || property.options.length === 0 || !property.options.includes(property.default))) throw new Error(`Opções inválidas em ${element.id}.${property.key}.`);
      if (['fontSize', 'opacity'].includes(property.type)
        && (!Number.isFinite(property.min) || !Number.isFinite(property.max) || property.min > property.max
          || property.min < (property.type === 'opacity' ? 0 : 10) || property.max > (property.type === 'opacity' ? 1 : 72)
          || !Number.isFinite(property.step) || property.step <= 0 || property.default < property.min || property.default > property.max)) throw new Error(`Limites inválidos em ${element.id}.${property.key}.`);
    }
    catalogElements.set(element.id, element);
  }
  for (const [id, entry] of Object.entries(config.elements)) {
    const definition = catalogElements.get(id);
    if (!definition || !isRecord(entry)) throw new Error(`Elemento visual não registrado: ${id}`);
    if (Object.keys(entry).some((key) => !['base', 'responsive', ...(catalog.version >= 2 ? ['geometry'] : [])].includes(key))) throw new Error(`Campo não permitido em ${id}`);
    if (entry.base !== undefined && !isRecord(entry.base)) throw new Error(`Propriedades base inválidas em ${id}`);
    const permitted = new Map(definition.properties.map((property) => [property.key, property]));
    for (const [key, value] of Object.entries(entry.base || {})) {
      const property = permitted.get(key);
      if (!property || !isValidBinding(property) || !isValidValue(property, value)) throw new Error(`Valor inválido em ${id}.${key}`);
    }
    for (const [breakpoint, values] of Object.entries(entry.responsive || {})) {
      if (!Object.hasOwn(breakpoints, breakpoint) || !values || typeof values !== 'object') throw new Error(`Breakpoint inválido em ${id}`);
      for (const [key, value] of Object.entries(values)) {
        const property = permitted.get(key);
        if (!property?.responsive || !isValidBinding(property) || !isValidValue(property, value)) throw new Error(`Valor responsivo inválido em ${id}.${key}`);
      }
    }
    if (entry.geometry !== undefined) {
      const geometry = definition.geometry;
      if (!geometry || geometry.type !== 'flow-box-v1' || geometry.binding !== 'css-flow-box-v1' || geometry.anchor !== 'flow'
        || geometry.units !== 'css-px' || !geometry.limits || !geometry.default || !Array.isArray(geometry.supports)
        || !isRecord(entry.geometry) || Object.keys(entry.geometry).some((key) => !['base', 'responsive'].includes(key))) throw new Error(`Geometria não permitida em ${id}`);
      if (entry.geometry.base !== undefined && !isRecord(entry.geometry.base)) throw new Error(`Geometria base inválida em ${id}`);
      if (entry.geometry.responsive !== undefined && (!geometry.responsive || !isRecord(entry.geometry.responsive)
        || Object.keys(entry.geometry.responsive).some((name) => !['mobile', 'tablet'].includes(name)))) throw new Error(`Overrides geométricos inválidos em ${id}`);
      const validateGeometryValues = (values) => {
        if (!values || typeof values !== 'object' || Array.isArray(values)
          || Object.keys(values).some((key) => !['x', 'y', 'width', 'height'].includes(key))) throw new Error(`Propriedade geométrica não permitida em ${id}`);
        for (const [key, value] of Object.entries(values)) {
          const limits = geometry.limits[key];
          if (!Number.isFinite(value) || !limits || value < limits.min || value > limits.max) throw new Error(`Geometria inválida em ${id}.${key}`);
        }
      };
      validateGeometryValues(entry.geometry.base || {});
      for (const [breakpoint, values] of Object.entries(entry.geometry.responsive || {})) {
        if (!geometry.responsive || !['mobile', 'tablet'].includes(breakpoint)) throw new Error(`Breakpoint geométrico inválido em ${id}`);
        validateGeometryValues(values);
      }
    }
  }
}

function targetFor(id, targetDocument = document) {
  const element = targetDocument.querySelector(`[data-editor-id="${id}"]`);
  if (!element) throw new Error(`Alvo do elemento editável ausente: ${id}`);
  return element;
}

function applyProperty(target, property, value) {
  const binding = property.binding;
  if (binding.operation === 'textContent') target.textContent = value;
  else if (binding.operation === 'styleVariable') target.style.setProperty(binding.name, property.type === 'fontSize' ? `${value}px` : String(value));
  else if (binding.operation === 'firstChildBackground') {
    if (!target.firstElementChild) throw new Error('Alvo de cor não possui elemento filho.');
    target.firstElementChild.style.backgroundColor = value;
  } else if (binding.operation === 'imageSource') target.setAttribute('src', assetPaths[value]);
  else if (binding.operation === 'visibility') target.hidden = !value;
  else throw new Error(`Operação de vínculo não registrada: ${binding.operation}`);
}

function captureOriginal(target, property) {
  const binding = property.binding;
  if (binding.operation === 'textContent') return { textContent: target.textContent };
  if (binding.operation === 'styleVariable') return { value: target.style.getPropertyValue(binding.name), priority: target.style.getPropertyPriority(binding.name) };
  if (binding.operation === 'firstChildBackground') {
    if (!target.firstElementChild) throw new Error('Alvo de cor não possui elemento filho.');
    return { value: target.firstElementChild.style.getPropertyValue('background-color'), priority: target.firstElementChild.style.getPropertyPriority('background-color') };
  }
  if (binding.operation === 'imageSource') return { hadAttribute: target.hasAttribute('src'), value: target.getAttribute('src') };
  if (binding.operation === 'visibility') return { hidden: target.hidden, hadAttribute: target.hasAttribute('hidden') };
  throw new Error(`Operação de vínculo não registrada: ${binding.operation}`);
}

function restoreOriginal(target, property, original) {
  const binding = property.binding;
  if (binding.operation === 'textContent') target.textContent = original.textContent;
  else if (binding.operation === 'styleVariable') {
    if (original.value) target.style.setProperty(binding.name, original.value, original.priority);
    else target.style.removeProperty(binding.name);
  } else if (binding.operation === 'firstChildBackground') {
    if (!target.firstElementChild) throw new Error('Alvo de cor não possui elemento filho.');
    if (original.value) target.firstElementChild.style.setProperty('background-color', original.value, original.priority);
    else target.firstElementChild.style.removeProperty('background-color');
  } else if (binding.operation === 'imageSource') {
    if (original.hadAttribute) target.setAttribute('src', original.value);
    else target.removeAttribute('src');
  } else if (binding.operation === 'visibility') {
    target.hidden = original.hidden;
    if (original.hadAttribute) target.setAttribute('hidden', '');
    else target.removeAttribute('hidden');
  }
}

function valuesForViewport(entry, targetWindow = window, breakpointOverride = null) {
  const values = { ...(entry.base || {}) };
  if (breakpointOverride === 'desktop') return values;
  if (breakpointOverride === 'mobile' || breakpointOverride === 'tablet') {
    Object.assign(values, entry.responsive?.[breakpointOverride] || {});
  } else {
    for (const [name, query] of Object.entries(breakpoints)) {
      if (targetWindow.matchMedia(query).matches) Object.assign(values, entry.responsive?.[name] || {});
    }
  }
  return values;
}

function geometryForViewport(entry, catalog, id, targetWindow = window) {
  const definition = catalog.elements.find((element) => element.id === id);
  const geometry = entry.geometry;
  if (!definition?.geometry || !geometry) return null;
  const values = { ...definition.geometry.default, ...(geometry.base || {}) };
  for (const [name, query] of Object.entries(breakpoints)) {
    if (targetWindow.matchMedia(query).matches) Object.assign(values, geometry.responsive?.[name] || {});
  }
  return values;
}

export function applyVisualConfiguration(catalog, config, targetDocument = document, breakpointOverride = null) {
  validateConfig(catalog, config);
  const targetWindow = targetDocument.defaultView;
  if (!targetWindow) throw new Error('O documento de prévia não está disponível.');
  for (const id of Object.keys(config.elements)) targetFor(id, targetDocument);
  const apply = () => {
    for (const definition of catalog.elements) {
      const { id } = definition;
      const entry = config.elements[id] || {};
      const target = targetFor(id, targetDocument);
      const values = valuesForViewport(entry, targetWindow, breakpointOverride);
      let previouslyApplied = appliedProperties.get(target);
      if (!previouslyApplied) {
        previouslyApplied = new Set();
        appliedProperties.set(target, previouslyApplied);
      }
      let originals = propertyBaselines.get(target);
      if (!originals) {
        originals = new Map();
        propertyBaselines.set(target, originals);
      }
      for (const property of definition.properties) {
        if (Object.hasOwn(values, property.key)) {
          if (!originals.has(property.key)) originals.set(property.key, captureOriginal(target, property));
          applyProperty(target, property, values[property.key]);
          previouslyApplied.add(property.key);
        } else if (previouslyApplied.has(property.key)) {
          restoreOriginal(target, property, originals.get(property.key));
          previouslyApplied.delete(property.key);
          originals.delete(property.key);
        }
      }
      const geometry = geometryForViewport(entry, catalog, id, targetWindow);
      const hasGeometry = Object.keys(entry.geometry?.base || {}).length > 0
        || Object.values(entry.geometry?.responsive || {}).some((values) => Object.keys(values).length > 0);
      if (geometry && hasGeometry) {
        target.dataset.trindadeGeometry = 'flow-box';
        for (const field of ['x', 'y', 'width', 'height']) {
          if (geometry[field] !== undefined) target.style.setProperty(`--studio-geometry-${field}`, `${geometry[field]}px`);
          else target.style.removeProperty(`--studio-geometry-${field}`);
        }
      } else {
        delete target.dataset.trindadeGeometry;
        for (const field of ['x', 'y', 'width', 'height']) target.style.removeProperty(`--studio-geometry-${field}`);
      }
    }
  };
  apply();
  return apply;
}

export async function refreshProjectAssets() {
  const session = new URLSearchParams(window.location.search).get('studioSession');
  const editorOrigin = new URLSearchParams(window.location.search).get('studioParent');
  const paths = { ...builtInAssetPaths };
  if (!session || !/^[a-f0-9]{64}$/.test(session)) {
    assetPaths = paths;
    return assetPaths;
  }
  const registryUrl = new URL('/assets/manifest.json', window.location.href);
  registryUrl.searchParams.set('studioSession', session);
  if (editorOrigin) registryUrl.searchParams.set('studioParent', editorOrigin);
  const response = await fetch(registryUrl, { credentials: 'omit', cache: 'no-store' });
  if (response.status === 404) {
    assetPaths = paths;
    return assetPaths;
  }
  if (!response.ok) throw new Error('A biblioteca de imagens do projeto está indisponível.');
  const manifest = await response.json();
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length > 500) throw new Error('Manifesto de imagens inválido.');
  const ids = new Set();
  for (const asset of manifest.assets) {
    const extension = asset?.mimeType === 'image/png' ? '.png' : asset?.mimeType === 'image/jpeg' ? '.jpg' : asset?.mimeType === 'image/webp' ? '.webp' : '';
    if (!extension || !/^img_[a-f0-9]{32}$/.test(asset.id) || ids.has(asset.id)
      || asset.file !== `assets/imported/${asset.id}${extension}` || !Number.isInteger(asset.size) || asset.size < 1 || asset.size > 5 * 1024 * 1024
      || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < 1 || asset.height < 1 || asset.width > 4096 || asset.height > 4096 || asset.width * asset.height > 16_000_000
      || typeof asset.sha256 !== 'string' || !new RegExp(`^${asset.id.slice(4)}[a-f0-9]{32}$`).test(asset.sha256)) {
      throw new Error('Um recurso da biblioteca não corresponde aos limites de imagem permitidos.');
    }
    ids.add(asset.id);
    const assetUrl = new URL(`/assets/imported/${asset.id}`, window.location.href);
    assetUrl.searchParams.set('studioSession', session);
    if (editorOrigin) assetUrl.searchParams.set('studioParent', editorOrigin);
    paths[asset.id] = assetUrl.href;
  }
  assetPaths = paths;
  return assetPaths;
}

export async function loadVisualConfig() {
  try {
    const [catalogResponse, visualResponse] = await Promise.all([fetch(catalogUrl), fetch(visualUrl)]);
    if (!catalogResponse.ok || !visualResponse.ok) throw new Error('Arquivos de configuração visual indisponíveis.');
    const [catalog, config] = await Promise.all([catalogResponse.json(), visualResponse.json()]);
    await refreshProjectAssets();
    validateConfig(catalog, config);
    const apply = applyVisualConfiguration(catalog, config);
    for (const query of Object.values(breakpoints)) window.matchMedia(query).addEventListener('change', apply);
    return { loaded: true };
  } catch (error) {
    console.warn(`[Trindade] Configuração visual ignorada; usando aparência padrão. ${error.message}`);
    return { loaded: false, error };
  }
}
