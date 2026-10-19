const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../../config/editor-elements.schema.json');

test('applies registered geometry only when configured and inherits mobile values safely', async () => {
  const { applyVisualConfiguration } = await import('../../src/game/ui/visual-config.js');
  let mobile = false;
  const properties = new Map();
  const target = {
    dataset: {},
    style: {
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: (key) => properties.delete(key),
    },
  };
  const document = {
    defaultView: { matchMedia: (query) => ({ matches: mobile && query === '(max-width: 600px)' }) },
    querySelector: () => target,
  };
  const config = {
    schemaVersion: 2,
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

  applyVisualConfiguration(catalog, { schemaVersion: 2, elements: { 'menu.card': { base: {} } } }, document);
  assert.equal(target.dataset.trindadeGeometry, undefined, 'Sem override, o runtime deve voltar ao CSS original.');
  assert.equal(properties.has('--studio-geometry-x'), false);
  assert.equal(properties.has('--studio-geometry-width'), false);
});
