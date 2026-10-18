import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfig } from '../src/game/ui/visual-config.js';

const catalog = JSON.parse(await readFile('config/editor-elements.schema.json', 'utf8'));
const visual = JSON.parse(await readFile('config/visual.json', 'utf8'));
const sandbox = JSON.parse(await readFile('config/gameplay.local.json', 'utf8'));
const modularHtml = await readFile('index.html', 'utf8');
const ids = new Set();

assert.equal(catalog.version, 1);
assert.equal(visual.schemaVersion, catalog.version);
assert.equal(sandbox.mode, 'local-sandbox');
validateConfig(catalog, visual);
assert.equal(catalog.elements.length, 9, 'Quantidade de elementos editáveis mudou sem atualizar a caracterização.');
for (const element of catalog.elements) {
  assert.match(element.id, /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/);
  assert.equal(ids.has(element.id), false, `ID duplicado: ${element.id}`);
  ids.add(element.id);
  assert.equal(element.target.attribute, 'data-editor-id');
  assert.ok(element.properties.length > 0);
  assert.ok(visual.elements[element.id], `Elemento sem configuração visual: ${element.id}`);
  const targetPattern = new RegExp(`data-editor-id="${element.id.replaceAll('.', '\\.')}"`, 'g');
  assert.equal([...modularHtml.matchAll(targetPattern)].length, 1, `Target ausente ou duplicado: ${element.id}`);
  for (const property of element.properties) {
    assert.ok(catalog.propertyTypes.includes(property.type));
    assert.equal(visual.elements[element.id].base?.[property.key], property.default, `Padrão divergente em ${element.id}.${property.key}`);
  }
}
assert.equal(Object.keys(visual.elements).length, catalog.elements.length, 'Configuração contém elemento ausente do catálogo.');

for (const [id, entry] of Object.entries(visual.elements)) {
  const element = catalog.elements.find((candidate) => candidate.id === id);
  assert.ok(element, `Configuração aponta para elemento não registrado: ${id}`);
  for (const key of Object.keys(entry.base || {})) assert.ok(element.properties.some((property) => property.key === key), `Propriedade não registrada: ${id}.${key}`);
  for (const [breakpoint, values] of Object.entries(entry.responsive || {})) {
    assert.ok(Object.hasOwn(catalog.breakpoints, breakpoint), `Breakpoint desconhecido: ${breakpoint}`);
    for (const key of Object.keys(values)) assert.ok(element.properties.find((property) => property.key === key)?.responsive, `Propriedade não responsiva: ${id}.${key}`);
  }
}

const unsafeColor = structuredClone(visual);
unsafeColor.elements['arena.background'].base.backgroundColor = 'url(https://example.invalid/image.png)';
assert.throws(() => validateConfig(catalog, unsafeColor), /Valor inválido/);
const unknownAsset = structuredClone(visual);
unknownAsset.elements['hands.player.image'].base.assetId = '../secret.png';
assert.throws(() => validateConfig(catalog, unknownAsset), /Valor inválido/);

const extensionCatalog = structuredClone(catalog);
extensionCatalog.elements.push({
  id: 'screen.pause.title',
  kind: 'text',
  labelKey: 'editor.elements.pauseTitle',
  target: { attribute: 'data-editor-id' },
  properties: [{ key: 'text', type: 'text', default: 'Pausa', binding: { operation: 'textContent' }, responsive: false }],
});
const extensionConfig = structuredClone(visual);
extensionConfig.elements['screen.pause.title'] = { base: { text: 'Pausa' } };
assert.doesNotThrow(() => validateConfig(extensionCatalog, extensionConfig), 'Novo ID não reutilizou uma operação genérica existente.');

process.stdout.write(`Configuration validation: ${ids.size} IDs únicos, defaults/config válidos e extensão genérica sem adaptador por ID\n`);
