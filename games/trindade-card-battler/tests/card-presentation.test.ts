import assert from 'node:assert/strict';
import test from 'node:test';
import { cardDefinitions } from '../src/game/cards.ts';
import type { CardInstance } from '../src/game/types.ts';
import { cardPresentationCatalog, renderCardBack, renderCardFace, renderDeckCardBack, sigilByCardKind } from '../src/ui/card-presentation.ts';

function instance(definitionId: string, health = 4): CardInstance {
  return { instanceId: `test-${definitionId}`, definitionId, owner: 'player', health, nextAttackAtMs: 0, revealed: true };
}

test('every catalog card has an independent visual configuration using supplied backgrounds and symbols', () => {
  assert.deepEqual(Object.keys(cardPresentationCatalog).sort(), cardDefinitions.map((card) => card.id).sort());
  assert.deepEqual(new Set(Object.values(cardPresentationCatalog).map((entry) => entry.background)), new Set(['red', 'green', 'blue', 'purple', 'yellow']));
  assert.deepEqual(sigilByCardKind, { troop: 'crystal-green', spell: 'crystal-orange', hidden: 'crystal-purple' });
});

test('hidden cards use the supplied full card-back asset', () => {
  const html = renderCardBack('enemy');
  assert.match(html, /class="card-back__image"/);
  assert.match(html, /card-back\.png/);
  assert.doesNotMatch(html, /card-face__frame|card-face__background|✧/);
  assert.match(renderDeckCardBack(), /card-back\.png/);
});

test('one face renderer covers hand, field, and preview while combat stats remain live data', () => {
  const troop = cardDefinitions.find((card) => card.id === 'solemn-guardian')!;
  for (const context of ['hand', 'field', 'preview'] as const) {
    const html = renderCardFace(troop, instance(troop.id, 2), 'player', context);
    assert.match(html, new RegExp(`card-face--${context}`));
    assert.match(html, /card-face__background/);
    assert.match(html, /card-face__frame/);
    assert.match(html, /card-face__sigil/);
    assert.match(html, /card-face__stat--blue[^>]*>2</);
    assert.match(html, /card-face__stat--red[^>]*>2</);
    assert.match(html, /Ilustração provisória/);
  }
  assert.match(renderCardFace(troop, instance(troop.id, 1), 'player', 'field'), /card-face__stat--red[^>]*>1</);
});

test('spells present their existing cost and configured effect, while sigils do not invent a second stat', () => {
  const spell = cardDefinitions.find((card) => card.id === 'wandering-flame')!;
  const sigil = cardDefinitions.find((card) => card.id === 'eclipse-seal')!;
  assert.match(renderCardFace(spell, instance(spell.id, 0), 'player', 'preview'), /Custo demonstrativo 2; Dano do feitiço 2/);
  assert.match(renderCardFace(sigil, instance(sigil.id, 0), 'player', 'preview'), /Efeito ainda não definido nesta versão/);
  assert.match(renderCardFace(spell, instance(spell.id, 0), 'player', 'preview'), /data-sigil="crystal-orange"/);
  assert.match(renderCardFace(sigil, instance(sigil.id, 0), 'player', 'preview'), /data-sigil="crystal-purple"/);
});
