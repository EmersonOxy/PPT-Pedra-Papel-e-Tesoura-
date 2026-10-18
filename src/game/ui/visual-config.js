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
  if (catalog?.version !== 1 || config?.schemaVersion !== 1 || !config.elements || typeof config.elements !== 'object') {
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
    if (!definition || !entry || typeof entry !== 'object') throw new Error(`Elemento visual não registrado: ${id}`);
    if (Object.keys(entry).some((key) => !['base', 'responsive'].includes(key))) throw new Error(`Campo não permitido em ${id}`);
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
  }
}

function targetFor(id) {
  const element = document.querySelector(`[data-editor-id="${id}"]`);
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

function valuesForViewport(entry) {
  const values = { ...(entry.base || {}) };
  for (const [name, query] of Object.entries(breakpoints)) {
    if (window.matchMedia(query).matches) Object.assign(values, entry.responsive?.[name] || {});
  }
  return values;
}

export async function loadVisualConfig() {
  try {
    const [catalogResponse, visualResponse] = await Promise.all([fetch(catalogUrl), fetch(visualUrl)]);
    if (!catalogResponse.ok || !visualResponse.ok) throw new Error('Arquivos de configuração visual indisponíveis.');
    const [catalog, config] = await Promise.all([catalogResponse.json(), visualResponse.json()]);
    validateConfig(catalog, config);
    for (const id of Object.keys(config.elements)) targetFor(id);
    const apply = () => {
      for (const [id, entry] of Object.entries(config.elements)) {
        const definition = catalog.elements.find((element) => element.id === id);
        const properties = new Map(definition.properties.map((property) => [property.key, property]));
        const target = targetFor(id);
        for (const [key, value] of Object.entries(valuesForViewport(entry))) applyProperty(target, properties.get(key), value);
      }
    };
    apply();
    for (const query of Object.values(breakpoints)) window.matchMedia(query).addEventListener('change', apply);
    return { loaded: true };
  } catch (error) {
    console.warn(`[Trindade] Configuração visual ignorada; usando aparência padrão. ${error.message}`);
    return { loaded: false, error };
  }
}
