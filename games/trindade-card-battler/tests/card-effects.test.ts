import assert from 'node:assert/strict';
import test from 'node:test';
import { cardDefinitions } from '../src/game/cards.ts';
import { cardEffects } from '../src/ui/card-effects.ts';

test('every current card has complete presentation effects without combat modifiers', () => {
  assert.deepEqual(Object.keys(cardEffects).sort(), cardDefinitions.map(card => card.id).sort());
  for (const card of cardDefinitions) {
    const effect = cardEffects[card.id]!;
    assert.match(effect.color, /^#[0-9a-f]{6}$/i);
    assert.ok(['slash', 'impact', 'leaves', 'mist', 'spark', 'orb'].includes(effect.trail));
    assert.ok(['brace', 'recoil', 'veil'].includes(effect.hit));
    assert.ok(['mist', 'fall', 'crumble', 'embers'].includes(effect.death));
    assert.deepEqual(Object.keys(effect).sort(), ['color', 'death', 'hit', 'trail']);
  }
});
