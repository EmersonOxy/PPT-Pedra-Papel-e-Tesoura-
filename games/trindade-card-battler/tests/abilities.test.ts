import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDefinitions, getCardDefinition } from '../src/game/cards.ts';
import { activateSigil, assignAllyLink, assignDirectAttackTarget, assignAttackTarget, beginPreparation, castSpell, createGame, drawCard, moveTroop } from '../src/game/engine.ts';
import { effectiveAttack, effectiveAttackInterval } from '../src/game/combat-rules.ts';
import { advanceTime } from '../src/game/simulation.ts';
import { takeAiAction } from '../src/game/ai.ts';
import { attackIntervalFor, balance } from '../src/game/config.ts';
import type { CardInstance, GameState, Side } from '../src/game/types.ts';

const ids = { dead: 'solemn-guardian', witch: 'veil-oracle', ogre: 'moss-colossus', fox: 'amber-phoenix', goblin: 'astral-fox', peasant: 'ember-knight', heal: 'runic-pulse', fire: 'wandering-flame', thorns: 'sleeping-thorns', roots: 'vesper-blade', volcano: 'eclipse-seal' };
function unit(side: Side, definitionId: string, instanceId: string, health = getCardDefinition(definitionId).maxHealth, due = 99_000): CardInstance {
  return { instanceId, definitionId, owner: side, health, revealed: false, nextAttackAtMs: due };
}
function game(): GameState {
  const state = createGame(123);
  state.nextAiAtMs = Number.POSITIVE_INFINITY;
  for (const side of ['player', 'enemy'] as const) {
    state.players[side].hand = [];
    state.players[side].deck = [];
  }
  return state;
}
function fire(state: GameState, side: Side, targetSide: Side, slot: number): GameState {
  const spell = unit(side, ids.fire, `fire-${state.clockMs}-${state.nextInstanceNumber++}`);
  state.players[side].hand.push(spell);
  return castSpell(state, side, spell.instanceId, { kind: 'unit', side: targetSide, slot }).state;
}

test('all eleven cards expose the requested test attributes and real arts', () => {
  assert.equal(cardDefinitions.length, 11);
  for (const [id, attack, health, interval] of [[ids.dead, 1, 6, 7000], [ids.witch, 1, 5, 9000], [ids.ogre, 3, 11, 10000], [ids.fox, 1, 4, 8000], [ids.goblin, 1, 4, 7000], [ids.peasant, 2, 6, 7000]] as const) {
    assert.equal(getCardDefinition(id).attack, attack, id);
    assert.equal(getCardDefinition(id).maxHealth, health, id);
    assert.equal(attackIntervalFor(id), interval, id);
  }
  for (const id of [ids.roots, ids.volcano, ids.thorns]) assert.equal(getCardDefinition(id).kind, 'hidden');
  assert.equal(balance.deckSize, 24);
  assert.equal(balance.handLimit, 6);
});

test('Morto Vivo resurrects once in place and its second lethal hit destroys it on either side', () => {
  for (const side of ['player', 'enemy'] as const) {
    const enemy = side === 'player' ? 'enemy' : 'player';
    let state = game();
    state.players[side].slots[0] = unit(side, ids.dead, 'undead', 3);
    state = fire(state, enemy, side, 0);
    assert.equal(state.players[side].slots[0]?.instanceId, 'undead');
    assert.equal(state.players[side].slots[0]?.health, 2);
    assert.equal(state.players[side].slots[0]?.resurrectionUsed, true);
    state = fire(state, enemy, side, 0);
    assert.equal(state.players[side].slots[0], null);
  }
});

test('Bruxa waits for definitive death and summons one 1/2 derived unit after an allied death in any column', () => {
  let state = game();
  state.players.player.slots[1] = unit('player', ids.dead, 'original', 3);
  state.players.player.slots[3] = unit('player', ids.witch, 'witch');
  state = fire(state, 'enemy', 'player', 1);
  assert.equal(state.players.player.slots[1]?.instanceId, 'original', 'resurrection is not definitive death');
  assert.notEqual(state.players.player.slots[3]?.summonUsed, true);
  state = fire(state, 'enemy', 'player', 1);
  const summoned = state.players.player.slots[1]!;
  assert.equal(summoned.definitionId, ids.dead);
  assert.equal(summoned.health, 2);
  assert.equal(summoned.derived, true);
  assert.equal(state.players.player.slots[3]?.summonUsed, true);
  assert.equal(effectiveAttack(summoned), 1);
  assert.equal(effectiveAttackInterval(state, summoned), 7000);
  assert.equal(state.players.player.deck.length, 0);
  state = fire(state, 'enemy', 'player', 1);
  assert.equal(state.players.player.slots[1], null, 'derived undead cannot resurrect or be summoned twice');
});

test('Ogro spills excess frontal damage only to the rear of that column', () => {
  const state = game();
  state.players.player.slots[0] = unit('player', ids.ogre, 'ogre', 11, 1000);
  state.players.enemy.slots[3] = unit('enemy', ids.goblin, 'front', 1);
  state.players.enemy.slots[0] = unit('enemy', ids.goblin, 'rear', 4);
  const result = advanceTime(state, 1000);
  assert.equal(result.state.players.enemy.slots[3], null);
  assert.equal(result.state.players.enemy.slots[0]?.health, 2);
  assert.equal(result.state.players.enemy.life, 20);
  const noRear = game();
  noRear.players.player.slots[0] = unit('player', ids.ogre, 'ogre', 11, 1000);
  noRear.players.enemy.slots[3] = unit('enemy', ids.goblin, 'front', 1);
  assert.equal(advanceTime(noRear, 1000).state.players.enemy.life, 20);
});

test('Raposa links from rear only, removes interval buffs when source or target dies, and can relink', () => {
  let state = game();
  state.players.player.slots[3] = unit('player', ids.fox, 'fox');
  state.players.player.slots[0] = unit('player', ids.goblin, 'ally', 3);
  state.players.player.slots[1] = unit('player', ids.ogre, 'other');
  state = assignAllyLink(state, 'player', 3, 0).state;
  assert.equal(state.players.player.slots[3]?.linkedAllyId, 'ally');
  assert.equal(effectiveAttackInterval(state, state.players.player.slots[0]!), 6000);
  state = fire(state, 'enemy', 'player', 0);
  assert.equal(state.players.player.slots[3]?.linkedAllyId, undefined);
  state = assignAllyLink(state, 'player', 3, 1).state;
  assert.equal(effectiveAttackInterval(state, state.players.player.slots[1]!), 9000);
  state.players.player.slots[3]!.health = 3;
  state = fire(state, 'enemy', 'player', 3);
  assert.equal(effectiveAttackInterval(state, state.players.player.slots[1]!), 10000);
});

test('rear Goblin can target player through defenders and heals only up to max health', () => {
  let state = game();
  state.players.player.slots[3] = unit('player', ids.goblin, 'goblin', 3, 1000);
  state.players.enemy.slots[3] = unit('enemy', ids.ogre, 'blocker');
  state = assignDirectAttackTarget(state, 'player', 3).state;
  const hit = advanceTime(state, 1000);
  assert.equal(hit.state.players.enemy.life, 19);
  assert.equal(hit.state.players.enemy.slots[3]?.health, 11);
  assert.equal(hit.state.players.player.slots[3]?.health, 4);
  const again = advanceTime(hit.state, 7000);
  assert.equal(again.state.players.player.slots[3]?.health, 4);
  state.players.player.slots[3] = unit('player', ids.ogre, 'not-goblin');
  assert.equal(assignDirectAttackTarget(state, 'player', 3).events.length, 0);
});

test('Camponês fury is derived from current health and disappears after healing', () => {
  const peasant = unit('player', ids.peasant, 'peasant', 4);
  assert.equal(effectiveAttack(peasant), 2);
  peasant.health = 3;
  assert.equal(effectiveAttack(peasant), 3);
  let state = game();
  state.players.player.slots[0] = { ...peasant, lastDamageReceived: 3 };
  state.players.player.hand = [unit('player', ids.heal, 'heal')];
  state = castSpell(state, 'player', 'heal', { kind: 'unit', side: 'player', slot: 0 }).state;
  assert.equal(state.players.player.slots[0]?.health, 6);
  assert.equal(effectiveAttack(state.players.player.slots[0]!), 2);
});

test('Cura requires an actual last hit, caps at four and max life, and cannot heal players', () => {
  const state = game();
  state.players.player.slots[0] = unit('player', ids.ogre, 'ogre', 5);
  state.players.player.hand = [unit('player', ids.heal, 'heal')];
  assert.equal(castSpell(state, 'player', 'heal', { kind: 'unit', side: 'player', slot: 0 }).events.length, 0);
  assert.equal(castSpell(state, 'player', 'heal', { kind: 'life', side: 'player' }).events.length, 0);
  state.players.player.slots[0]!.lastDamageReceived = 7;
  const healed = castSpell(state, 'player', 'heal', { kind: 'unit', side: 'player', slot: 0 });
  assert.equal(healed.state.players.player.slots[0]?.health, 9);
  assert.equal(healed.state.players.player.hand.length, 0);
  healed.state.players.player.hand = [unit('player', ids.heal, 'heal-again')];
  assert.equal(castSpell(healed.state, 'player', 'heal-again', { kind: 'unit', side: 'player', slot: 0 }).state.players.player.slots[0]?.health, 11);
});

test('Bola de Fogo applies 3 plus 1 to that column once, recording the last hit; no direct-life casts', () => {
  const state = game();
  state.players.enemy.slots[0] = unit('enemy', ids.ogre, 'main');
  state.players.enemy.slots[3] = unit('enemy', ids.ogre, 'splash');
  state.players.enemy.slots[1] = unit('enemy', ids.ogre, 'untouched');
  state.players.player.hand = [unit('player', ids.fire, 'fire')];
  assert.equal(castSpell(state, 'player', 'fire', { kind: 'life', side: 'enemy' }).events.length, 0);
  const cast = castSpell(state, 'player', 'fire', { kind: 'unit', side: 'enemy', slot: 0 });
  assert.equal(cast.state.players.enemy.slots[0]?.health, 8);
  assert.equal(cast.state.players.enemy.slots[0]?.lastDamageReceived, 3);
  assert.equal(cast.state.players.enemy.slots[3]?.health, 10);
  assert.equal(cast.state.players.enemy.slots[1]?.health, 11);
  assert.equal(castSpell(cast.state, 'player', 'fire', { kind: 'unit', side: 'enemy', slot: 0 }).events.length, 0);
});

test('oldest thorns reveals before damage, cancels killed attackers and leaves the second trap armed', () => {
  const state = game();
  state.players.player.slots[0] = unit('player', ids.goblin, 'attacker', 2, 1000);
  state.players.enemy.slots[3] = unit('enemy', ids.ogre, 'defender');
  state.players.enemy.sigils[0] = { ...unit('enemy', ids.thorns, 'newest'), placedAtMs: 20 };
  state.players.enemy.sigils[1] = { ...unit('enemy', ids.thorns, 'oldest'), placedAtMs: 10 };
  const result = advanceTime(state, 1000);
  assert.equal(result.state.players.player.slots[0], null);
  assert.equal(result.state.players.enemy.slots[3]?.health, 11);
  assert.equal(result.state.players.enemy.sigils[0]?.instanceId, 'newest');
  assert.equal(result.state.players.enemy.sigils[1], null);
  const reveal = result.events.findIndex(event => event.type === 'reveal');
  const damage = result.events.findIndex(event => event.type === 'damage');
  assert.ok(reveal >= 0 && damage > reveal);
});

test('thorns does not trigger for movement or direct damage, adds two seconds to surviving attacker cooldown', () => {
  const state = game();
  state.players.player.slots[0] = unit('player', ids.ogre, 'attacker', 11, 1000);
  state.players.enemy.sigils[0] = unit('enemy', ids.thorns, 'thorns');
  assert.equal(moveTroop(state, 'player', 0, 1).state.players.enemy.sigils[0]?.instanceId, 'thorns');
  const direct = advanceTime(state, 1000);
  assert.equal(direct.state.players.enemy.sigils[0]?.instanceId, 'thorns');
  state.players.enemy.slots[3] = unit('enemy', ids.ogre, 'defender');
  const hit = advanceTime(state, 1000);
  assert.equal(hit.state.players.enemy.slots[3]?.health, 8);
  assert.equal(hit.state.players.player.slots[0]?.health, 9);
  assert.equal(hit.state.players.player.slots[0]?.nextAttackAtMs, 13000);
  assert.equal(activateSigil(state, 'enemy', 0).events.length, 0, 'automatic thorns cannot be activated manually');
});

test('roots cancels movement, blocks reposition for four seconds, delays attack without silencing, and works manually', () => {
  let state = game();
  state.players.player.slots[0] = unit('player', ids.goblin, 'runner', 4, 1000);
  state.players.enemy.sigils[0] = unit('enemy', ids.roots, 'roots');
  const caught = moveTroop(state, 'player', 0, 1);
  state = caught.state;
  assert.equal(state.players.player.slots[0]?.instanceId, 'runner');
  assert.equal(state.players.player.slots[1], null);
  assert.equal(state.players.enemy.sigils[0], null);
  assert.equal(state.players.player.slots[0]?.rootedUntilMs, 4000);
  assert.equal(state.players.player.slots[0]?.nextAttackAtMs, 3000);
  assert.equal(moveTroop(state, 'player', 0, 1).events.length, 0);
  const attacking = advanceTime(state, 3000);
  assert.ok(attacking.events.some(event => event.type === 'attack'));
  state = advanceTime(attacking.state, 1000).state;
  assert.equal(moveTroop(state, 'player', 0, 1).state.players.player.slots[1]?.instanceId, 'runner');
  state.players.enemy.sigils[0] = unit('enemy', ids.roots, 'roots-manual');
  const manual = activateSigil(state, 'enemy', 0, 0);
  assert.equal(manual.state.players.enemy.sigils[0], null);
  assert.equal(manual.state.players.player.slots[0]?.rootedUntilMs, 8000);
  assert.equal(activateSigil(manual.state, 'enemy', 0, 0).events.length, 0);
});

test('volcano hits both sides over exactly three waves, includes new units and continues without owner troops', () => {
  const state = game();
  state.players.player.slots[0] = unit('player', ids.goblin, 'friendly', 1);
  state.players.enemy.slots[0] = unit('enemy', ids.ogre, 'hostile');
  state.players.enemy.slots[4] = unit('enemy', ids.ogre, 'hostile-other-column');
  state.players.player.sigils[0] = unit('player', ids.volcano, 'volcano');
  const start = activateSigil(state, 'player', 0);
  start.state.nextAiAtMs = Number.POSITIVE_INFINITY;
  start.state.aiStarted = false;
  assert.equal(start.state.players.player.sigils[0], null);
  assert.equal(start.state.players.player.slots[0], null);
  assert.equal(start.state.players.enemy.slots[0]?.health, 9);
  assert.equal(start.state.players.enemy.slots[4]?.health, 9);
  assert.equal(activateSigil(start.state, 'player', 0).events.length, 0);
  let next = advanceTime(start.state, 3999);
  assert.equal(next.state.players.enemy.slots[0]?.health, 9);
  next.state.players.enemy.slots[2] = unit('enemy', ids.ogre, 'newcomer');
  next = advanceTime(next.state, 1);
  assert.equal(next.state.players.enemy.slots[0]?.health, 7);
  assert.equal(next.state.players.enemy.slots[2]?.health, 9);
  next = advanceTime(next.state, 4000);
  assert.equal(next.state.players.enemy.slots[0]?.health, 5);
  assert.equal(next.state.players.enemy.slots[2]?.health, 7);
  assert.equal(next.state.players.player.life, 20);
  assert.equal(next.state.players.enemy.life, 20);
  assert.equal(advanceTime(next.state, 4000).state.players.enemy.slots[0]?.health, 5);
});

test('area damage uses normal death abilities and remains deterministic across coarse and fine time steps', () => {
  const state = game();
  state.players.enemy.slots[0] = unit('enemy', ids.dead, 'undead', 2);
  state.players.enemy.slots[3] = unit('enemy', ids.witch, 'witch');
  state.players.player.sigils[0] = unit('player', ids.volcano, 'volcano');
  const erupted = activateSigil(state, 'player', 0).state;
  assert.equal(erupted.players.enemy.slots[0]?.resurrectionUsed, true);
  const coarse = advanceTime(erupted, 8000).state;
  let fine = erupted;
  for (let i = 0; i < 80; i++) fine = advanceTime(fine, 100).state;
  assert.deepEqual(coarse, fine);
  assert.equal(coarse.players.enemy.slots[0], null);
});

test('rear troops stay in standby without order and pre-combat prevents attacks and activations', () => {
  const state = game();
  state.players.player.slots[3] = unit('player', ids.ogre, 'rear', 11, 1000);
  state.players.enemy.slots[3] = unit('enemy', ids.ogre, 'enemy');
  assert.equal(advanceTime(state, 1000).events.some(event => event.type === 'attack'), false);
  const targeted = assignAttackTarget(state, 'player', 3, 3);
  assert.ok(targeted.events.length > 0);
  state.players.player.sigils[0] = unit('player', ids.volcano, 'volcano');
  const prep = beginPreparation(state).state;
  assert.equal(activateSigil(prep, 'player', 0).events.length, 0);
  assert.equal(advanceTime(prep, 1000).events.some(event => ['attack', 'damage', 'reveal'].includes(event.type)), false);
});

test('AI can deploy all hidden types and troops using validated engine actions', () => {
  for (const definition of cardDefinitions.filter(card => card.kind !== 'spell')) {
    const state = game();
    state.players.enemy.hand = [unit('enemy', definition.id, `ai-${definition.id}`)];
    const result = takeAiAction(state);
    assert.ok(result.state.players.enemy.slots.some(Boolean) || result.state.players.enemy.sigils.some(Boolean), definition.name);
  }
});

test('24 unique instances, manual draw limit, no automatic draw, no timer replay and input state immutability', () => {
  const state = createGame(987);
  state.nextAiAtMs = Number.POSITIVE_INFINITY;
  for (const side of ['player', 'enemy'] as const) {
    const cards = [...state.players[side].hand, ...state.players[side].deck];
    assert.equal(cards.length, 24);
    assert.equal(new Set(cards.map(card => card.instanceId)).size, 24);
    assert.equal(drawCard(state, side).events.length, 0);
  }
  const battle = game();
  battle.players.player.slots[0] = unit('player', ids.goblin, 'single', 4, 1000);
  const snapshot = structuredClone(battle);
  const first = advanceTime(battle, 1000);
  assert.deepEqual(battle, snapshot);
  assert.equal(first.events.filter(event => event.type === 'attack').length, 1);
  assert.equal(advanceTime(first.state, 1).events.filter(event => event.type === 'attack').length, 0);
  assert.equal(first.state.players.player.hand.length, 0);
});

test('recycling preserves identities and increments one cycle without duplicating derived summons', () => {
  let state = game();
  state.players.player.discard = [unit('player', ids.goblin, 'original-a'), unit('player', ids.ogre, 'original-b')];
  const snapshot = structuredClone(state);
  const first = drawCard(state, 'player');
  assert.equal(first.state.players.player.cycle, 2);
  assert.equal(first.events.filter(event => event.type === 'recycle').length, 1);
  assert.equal(first.state.players.player.discard?.length, 0);
  assert.deepEqual(state, snapshot);
  state = drawCard(first.state, 'player').state;
  assert.equal(state.players.player.cycle, 2);
  assert.deepEqual(state.players.player.hand.map(card => card.instanceId).sort(), ['original-a', 'original-b']);
  assert.equal(drawCard(state, 'player').events.length, 0);
});

test('AI casts both spells, links the rear Raposa and issues direct Goblin orders', () => {
  let state = game();
  state.players.enemy.slots[3] = { ...unit('enemy', ids.ogre, 'wounded', 6), lastDamageReceived: 3 };
  state.players.enemy.hand = [unit('enemy', ids.heal, 'heal-ai')];
  const heal = takeAiAction(state);
  assert.equal(heal.state.players.enemy.slots[3]?.health, 9);
  state = game();
  state.players.player.slots[0] = unit('player', ids.ogre, 'victim');
  state.players.enemy.hand = [unit('enemy', ids.fire, 'fire-ai')];
  assert.equal(takeAiAction(state).state.players.player.slots[0]?.health, 8);
  state = game();
  state.players.enemy.slots[0] = unit('enemy', ids.fox, 'fox-ai');
  state.players.enemy.slots[3] = unit('enemy', ids.ogre, 'ally-ai');
  assert.equal(takeAiAction(state).state.players.enemy.slots[0]?.linkedAllyId, 'ally-ai');
  state.players.enemy.slots[0] = unit('enemy', ids.goblin, 'goblin-ai');
  assert.equal(takeAiAction(state).state.players.enemy.slots[0]?.directAttackTarget, true);
});

test('AI activates manual roots and volcano, and can recycle its spent deck', () => {
  const state = game();
  state.players.player.slots[0] = unit('player', ids.ogre, 'target');
  state.players.enemy.sigils[0] = unit('enemy', ids.roots, 'root-ai');
  const rooted = takeAiAction(state);
  assert.equal(rooted.state.players.player.slots[0]?.rootedUntilMs, 4000);
  state.players.enemy.sigils[0] = unit('enemy', ids.volcano, 'volcano-ai');
  const erupting = takeAiAction(state);
  assert.equal(erupting.state.players.player.slots[0]?.health, 9);
  assert.equal(erupting.state.eruptions?.length, 1);
  const empty = game();
  empty.players.enemy.discard = [unit('enemy', ids.ogre, 'recycled-ai')];
  const recycled = takeAiAction(empty);
  assert.equal(recycled.state.players.enemy.cycle, 2);
  assert.ok(recycled.state.players.enemy.slots.some(card => card?.instanceId === 'recycled-ai'));
});

test('losing a rear manual target causes standby without repeatedly firing attacks', () => {
  let state = game();
  state.players.player.slots[3] = unit('player', ids.ogre, 'rear', 11, 1000);
  state.players.enemy.slots[3] = unit('enemy', ids.goblin, 'chosen', 1);
  state = assignAttackTarget(state, 'player', 3, 3).state;
  const first = advanceTime(state, 1000);
  assert.equal(first.state.players.enemy.slots[3], null);
  const waiting = advanceTime(first.state, 30_000);
  assert.equal(waiting.events.some(event => event.type === 'attack'), false);
  assert.equal(waiting.state.players.enemy.life, 20);
});

test('two simultaneous attackers consume separate thorns without reusing a consumed card', () => {
  const state = game();
  state.players.player.slots[0] = unit('player', ids.ogre, 'first', 11, 1000);
  state.players.player.slots[1] = unit('player', ids.ogre, 'second', 11, 1000);
  state.players.enemy.slots[3] = unit('enemy', ids.ogre, 'defender-a');
  state.players.enemy.slots[4] = unit('enemy', ids.ogre, 'defender-b');
  state.players.enemy.sigils[0] = unit('enemy', ids.thorns, 'trap-a');
  state.players.enemy.sigils[1] = unit('enemy', ids.thorns, 'trap-b');
  const result = advanceTime(state, 1000);
  assert.equal(result.events.filter(event => event.type === 'reveal').length, 2);
  assert.equal(result.state.players.enemy.sigils.filter(Boolean).length, 0);
  assert.equal(result.state.players.player.slots[0]?.health, 9);
  assert.equal(result.state.players.player.slots[1]?.health, 9);
});

test('a newly summoned replacement is not hit again during the wave that created it', () => {
  const state = game();
  state.players.enemy.slots[0] = unit('enemy', ids.goblin, 'doomed', 1);
  state.players.enemy.slots[3] = unit('enemy', ids.witch, 'witch');
  state.players.player.sigils[0] = unit('player', ids.volcano, 'volcano');
  const result = activateSigil(state, 'player', 0);
  assert.equal(result.state.players.enemy.slots[0]?.derived, true);
  assert.equal(result.state.players.enemy.slots[0]?.health, 2);
  assert.equal(result.events.filter(event => event.type === 'damage' && event.instanceId === result.state.players.enemy.slots[0]?.instanceId).length, 0);
});

test('selected 24-card decks use exactly the selected definitions and no collection copies are invented', () => {
  const selected = Array.from({ length: 24 }, (_, i) => i < 12 ? ids.ogre : ids.roots);
  const state = createGame(456, selected);
  const cards = [...state.players.player.hand, ...state.players.player.deck];
  assert.equal(cards.filter(card => card.definitionId === ids.ogre).length, 12);
  assert.equal(cards.filter(card => card.definitionId === ids.roots).length, 12);
  assert.equal(new Set(cards.map(card => card.instanceId)).size, 24);
});

test('trap death resurrects Morto Vivo before its declared attack and cannot trigger necromancy prematurely', () => {
  const state = game();
  state.players.player.slots[0] = unit('player', ids.dead, 'attacker', 1, 1000);
  state.players.player.slots[3] = unit('player', ids.witch, 'witch');
  state.players.enemy.slots[3] = unit('enemy', ids.ogre, 'defender');
  state.players.enemy.sigils[0] = unit('enemy', ids.thorns, 'thorns');
  const result = advanceTime(state, 1000);
  assert.equal(result.state.players.player.slots[0]?.instanceId, 'attacker');
  assert.equal(result.state.players.player.slots[0]?.health, 2);
  assert.equal(result.state.players.player.slots[3]?.summonUsed, undefined);
  assert.equal(result.events.filter(event => event.type === 'resurrect').length, 1);
  assert.equal(result.events.filter(event => event.type === 'summon').length, 0);
});
