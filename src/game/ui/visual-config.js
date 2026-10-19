const catalogUrl = new URL('../../../config/editor-elements.schema.json', import.meta.url);
const visualUrl = new URL('../../../config/visual.json', import.meta.url);
const assetPaths = Object.freeze({
  'hands.rock': './assets/images/hand-rock.png',
  'hands.paper': './assets/images/hand-paper.png',
  'hands.scissors': './assets/images/hand-scissors.png',
});
const colorPattern = /^#[0-9a-f]{6}$/i;
const breakpoints = Object.freeze({
  mobile: '(max-width: 600px)',
  tablet: '(min-width: 601px) and (max-width: 750px)',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidValue(type, value) {
  if (type === 'text') return typeof value === 'string' && value.length <= 80;
  if (type === 'color') return typeof value === 'string' && colorPattern.test(value);
  if (type === 'imageAsset') return typeof value === 'string' && Object.hasOwn(assetPaths, value);
  return false;
}

function isValidBinding(property) {
  const binding = property?.binding;
  if (!binding || typeof binding !== 'object') return false;
  if (binding.operation === 'textContent') return property.type === 'text' && Object.keys(binding).length === 1;
  if (binding.operation === 'styleVariable') return property.type === 'color' && Object.keys(binding).length === 2 && /^--[a-z][a-z0-9-]*$/.test(binding.name);
  if (binding.operation === 'firstChildBackground') return property.type === 'color' && Object.keys(binding).length === 1;
  if (binding.operation === 'imageSource') return property.type === 'imageAsset' && Object.keys(binding).length === 1;
  return false;
}

export function validateConfig(catalog, config) {
  if (![1, 2].includes(catalog?.version) || config?.schemaVersion !== catalog.version || !config.elements || typeof config.elements !== 'object') {
    throw new Error('Versão ou formato da configuração visual não reconhecido.');
  }

  if (!Array.isArray(catalog.elements)) throw new Error('Catálogo de elementos inválido.');
  const catalogElements = new Map();
  for (const element of catalog.elements) {
    if (!element || typeof element.id !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(element.id) || catalogElements.has(element.id)) {
      throw new Error('ID de elemento ausente, inválido ou duplicado.');
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
      if (!property || !isValidBinding(property) || !isValidValue(property.type, value)) throw new Error(`Valor inválido em ${id}.${key}`);
    }
    for (const [breakpoint, values] of Object.entries(entry.responsive || {})) {
      if (!Object.hasOwn(breakpoints, breakpoint) || !values || typeof values !== 'object') throw new Error(`Breakpoint inválido em ${id}`);
      for (const [key, value] of Object.entries(values)) {
        const property = permitted.get(key);
        if (!property?.responsive || !isValidBinding(property) || !isValidValue(property.type, value)) throw new Error(`Valor responsivo inválido em ${id}.${key}`);
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
  else if (binding.operation === 'styleVariable') target.style.setProperty(binding.name, value);
  else if (binding.operation === 'firstChildBackground') {
    if (!target.firstElementChild) throw new Error('Alvo de cor não possui elemento filho.');
    target.firstElementChild.style.backgroundColor = value;
  } else if (binding.operation === 'imageSource') target.setAttribute('src', assetPaths[value]);
  else throw new Error(`Operação de vínculo não registrada: ${binding.operation}`);
}

function valuesForViewport(entry, targetWindow = window) {
  const values = { ...(entry.base || {}) };
  for (const [name, query] of Object.entries(breakpoints)) {
    if (targetWindow.matchMedia(query).matches) Object.assign(values, entry.responsive?.[name] || {});
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

export function applyVisualConfiguration(catalog, config, targetDocument = document) {
  validateConfig(catalog, config);
  const targetWindow = targetDocument.defaultView;
  if (!targetWindow) throw new Error('O documento de prévia não está disponível.');
  for (const id of Object.keys(config.elements)) targetFor(id, targetDocument);
  const apply = () => {
    for (const [id, entry] of Object.entries(config.elements)) {
      const definition = catalog.elements.find((element) => element.id === id);
      const properties = new Map(definition.properties.map((property) => [property.key, property]));
      const target = targetFor(id, targetDocument);
      for (const [key, value] of Object.entries(valuesForViewport(entry, targetWindow))) {
        applyProperty(target, properties.get(key), value);
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

export async function loadVisualConfig() {
  try {
    const [catalogResponse, visualResponse] = await Promise.all([fetch(catalogUrl), fetch(visualUrl)]);
    if (!catalogResponse.ok || !visualResponse.ok) throw new Error('Arquivos de configuração visual indisponíveis.');
    const [catalog, config] = await Promise.all([catalogResponse.json(), visualResponse.json()]);
    validateConfig(catalog, config);
    const apply = applyVisualConfiguration(catalog, config);
    for (const query of Object.values(breakpoints)) window.matchMedia(query).addEventListener('change', apply);
    return { loaded: true };
  } catch (error) {
    console.warn(`[Trindade] Configuração visual ignorada; usando aparência padrão. ${error.message}`);
    return { loaded: false, error };
  }
}
