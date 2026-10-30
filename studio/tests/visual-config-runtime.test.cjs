const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../../games/pedra-papel-tesoura/config/editor-elements.schema.json');

test('applies registered geometry only when configured and inherits mobile values safely', async () => {
  const { applyVisualConfiguration } = await import('../../games/pedra-papel-tesoura/src/game/ui/visual-config.js');
  let mobile = false;
  const properties = new Map();
  const targets = new Map(catalog.elements.map((element) => {
    const values = element.id === 'menu.card' ? properties : new Map();
    return [element.id, {
      dataset: {}, hidden: false, hasAttribute: () => false, getAttribute: () => null, setAttribute() {}, removeAttribute() {},
      style: {
        setProperty: (key, value) => values.set(key, value),
        getPropertyValue: (key) => values.get(key) || '',
        getPropertyPriority: () => '',
        removeProperty: (key) => values.delete(key),
      },
      firstElementChild: { style: { setProperty() {}, getPropertyValue: () => '', getPropertyPriority: () => '', removeProperty() {} } },
    }];
  }));
  const target = targets.get('menu.card');
  const document = {
    defaultView: { matchMedia: (query) => ({ matches: mobile && query === '(max-width: 600px)' }) },
    querySelector: (selector) => {
      const match = selector.match(/data-editor-id="([^"]+)"/);
      return match ? targets.get(match[1]) : null;
    },
  };
  const config = {
    schemaVersion: catalog.version,
    elements: {
      'menu.card': { base: {}, geometry: { base: { x: 5, y: 7, width: 400, height: 240 }, responsive: { mobile: { x: 12 } } } },
    },
  };
  applyVisualConfiguration(catalog, config, document);
  assert.equal(target.dataset.trindadeGeometry, 'flow-box');
  assert.equal(properties.get('--studio-geometry-x'), '5px');
  assert.equal(properties.get('--studio-geometry-y'), '7px');
  assert.equal(properties.get('--studio-geometry-width'), '400px');

  mobile = true;
  applyVisualConfiguration(catalog, config, document);
  assert.equal(properties.get('--studio-geometry-x'), '12px');
  assert.equal(properties.get('--studio-geometry-y'), '7px', 'Valores móveis ausentes devem herdar o valor base.');
  assert.equal(properties.get('--studio-geometry-width'), '400px');

  applyVisualConfiguration(catalog, { schemaVersion: catalog.version, elements: { 'menu.card': { base: {} } } }, document);
  assert.equal(target.dataset.trindadeGeometry, undefined, 'Sem override, o runtime deve voltar ao CSS original.');
  assert.equal(properties.has('--studio-geometry-x'), false);
  assert.equal(properties.has('--studio-geometry-width'), false);
});

test('applies typed visual overrides and restores the exact original title and visibility', async () => {
  const { applyVisualConfiguration } = await import('../../games/pedra-papel-tesoura/src/game/ui/visual-config.js');
  const targets = new Map();
  const makeStyle = () => {
    const values = new Map();
    const priorities = new Map();
    return {
      setProperty: (key, value, priority = '') => { values.set(key, value); priorities.set(key, priority); },
      getPropertyValue: (key) => values.get(key) || '',
      getPropertyPriority: (key) => priorities.get(key) || '',
      removeProperty: (key) => values.delete(key),
    };
  };
  for (const definition of catalog.elements) targets.set(definition.id, {
    textContent: definition.id === 'game.title' ? 'Pedra, papel e tesoura' : definition.id === 'menu.start' ? 'Jogar' : '',
    hidden: false,
    hasAttribute: (name) => name === 'hidden' && false,
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {},
    dataset: {},
    style: makeStyle(),
    firstElementChild: { style: makeStyle() },
  });
  let mobile = false;
  const document = {
    defaultView: { matchMedia: (query) => ({ matches: mobile && query === '(max-width: 600px)' }) },
    querySelector: (selector) => {
      const match = selector.match(/data-editor-id="([^"]+)"/);
      return match ? targets.get(match[1]) : null;
    },
  };
  const config = {
    schemaVersion: catalog.version,
    elements: {
      'game.title': { base: { fontFamily: 'Georgia', fontSize: 42, fontWeight: 700, textAlign: 'left', textColor: '#123456', opacity: 0.65, visible: false }, responsive: { mobile: { fontSize: 38 } } },
      'menu.start': { base: { text: 'Iniciar', backgroundColor: '#2468ac', visible: true } },
      'menu.card': { base: { opacity: 0.8 } },
      'arena.background': { base: { backgroundColor: '#ddeeff' } },
    },
  };
  applyVisualConfiguration(catalog, config, document);
  const title = targets.get('game.title');
  assert.equal(title.textContent, 'Pedra, papel e tesoura');
  assert.equal(title.hidden, true);
  assert.equal(title.style.getPropertyValue('--studio-font-family'), 'Georgia');
  assert.equal(title.style.getPropertyValue('--studio-font-size'), '42px');
  assert.equal(title.style.getPropertyValue('--studio-font-weight'), '700');
  assert.equal(title.style.getPropertyValue('--studio-text-align'), 'left');
  assert.equal(title.style.getPropertyValue('--studio-text-color'), '#123456');
  assert.equal(title.style.getPropertyValue('--studio-opacity'), '0.65');
  assert.equal(targets.get('menu.start').textContent, 'Iniciar');
  assert.equal(targets.get('menu.start').style.getPropertyValue('--studio-background-color'), '#2468ac');
  assert.equal(targets.get('menu.start').hidden, false);
  assert.equal(targets.get('menu.card').style.getPropertyValue('--studio-opacity'), '0.8');
  assert.equal(targets.get('arena.background').style.getPropertyValue('--arena-background'), '#ddeeff');

  applyVisualConfiguration(catalog, config, document, 'mobile');
  assert.equal(title.style.getPropertyValue('--studio-font-size'), '38px', 'A prévia pode forçar o breakpoint móvel selecionado pelo Studio.');
  mobile = true;
  applyVisualConfiguration(catalog, config, document, 'desktop');
  assert.equal(title.style.getPropertyValue('--studio-font-size'), '42px', 'Desktop força os valores base mesmo se o ambiente parecer celular.');
  mobile = false;
  applyVisualConfiguration(catalog, config, document, null);
  assert.equal(title.style.getPropertyValue('--studio-font-size'), '42px', 'O modo desktop volta ao valor base mesmo se a mídia ambiental indicar celular.');

  const cleared = { schemaVersion: catalog.version, elements: {} };
  applyVisualConfiguration(catalog, cleared, document);
  assert.equal(title.textContent, 'Pedra, papel e tesoura', 'Restaurar propriedades ausentes não pode deixar texto antigo no canvas.');
  assert.equal(title.hidden, false, 'Visibilidade original deve ser recuperada.');
  assert.equal(title.style.getPropertyValue('--studio-font-family'), '');
  assert.equal(title.style.getPropertyValue('--studio-font-size'), '');
  assert.equal(title.style.getPropertyValue('--studio-text-color'), '');
  assert.equal(targets.get('menu.start').textContent, 'Jogar');
  assert.equal(targets.get('menu.start').style.getPropertyValue('--studio-background-color'), '');
});
