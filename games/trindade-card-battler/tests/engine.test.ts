import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDefinitions, getCardDefinition } from '../src/game/cards.ts';
import { castSpell, createGame, drawCard, endWithWinner, moveTroop, placeCard, placeSigil, returnTroop, revealSigil } from '../src/game/engine.ts';
import * as gameEngineApi from '../src/game/engine.ts';
import { takeAiAction } from '../src/game/ai.ts';
import { advanceTime } from '../src/game/simulation.ts';
import { chooseAttackTarget } from '../src/game/targeting.ts';
import { balance, boardSlotCount, sigilSlotCount, topology, validateExperimentalBalance } from '../src/game/config.ts';
import type { CardInstance, GameState, Side } from '../src/game/types.ts';

const makeCard = (owner: Side, definitionId: string, id: string, health?: number, nextAttackAtMs = 0): CardInstance => ({
  instanceId: id,
  definitionId,
  owner,
  health: health ?? getCardDefinition(definitionId).maxHealth,
  nextAttackAtMs,
  revealed: false,
});

function fixture(seed = 42): GameState {
  const state = createGame(seed);
  state.nextAiAtMs = 1_000_000;
  return state;
}

test('deck has 24 cards, two copies of each demo and six opening cards per side', () => {
  assert.equal(cardDefinitions.length, 12);
  const game = createGame(123);
  for (const side of ['player', 'enemy'] as const) {
    assert.equal(game.players[side].hand.length, 6);
    assert.equal(game.players[side].deck.length, 18);
    assert.equal(game.players[side].deck.length + game.players[side].hand.length, 24);
    assert.equal(new Set([...game.players[side].deck, ...game.players[side].hand].map((card) => card.instanceId)).size, 24);
  }
});

test('seed produces deterministic opening hands and deck order', () => {
  const a = createGame(987);
  const b = createGame(987);
  assert.deepEqual(a.players.player.hand.map((card) => card.definitionId), b.players.player.hand.map((card) => card.definitionId));
  assert.deepEqual(a.players.enemy.deck.map((card) => card.instanceId), b.players.enemy.deck.map((card) => card.instanceId));
});

test('opponent waits for the first valid player action, then reacts after the configured grace period', () => {
  const game = createGame(123);
  const idle = advanceTime(game, 30_000);
  assert.equal(idle.state.players.player.life, 20);
  assert.equal(idle.state.players.enemy.slots.filter(Boolean).length, 0);
  assert.equal(idle.state.aiStarted, false);
  const troop = game.players.player.hand.find((card) => getCardDefinition(card.definitionId).kind === 'troop');
  if (!troop) throw new Error('A fixture determinística precisa conter uma tropa na mão.');
  const placed = placeCard(game, 'player', troop.instanceId, 0);
  assert.equal(placed.state.aiStarted, true);
  const beforeResponse = advanceTime(placed.state, 3999);
  assert.equal(beforeResponse.events.some((event) => event.type === 'draw' && event.side === 'enemy' || event.type === 'place' && event.side === 'enemy'), false);
  const response = advanceTime(beforeResponse.state, 1);
  assert.ok(response.events.some((event) => event.type === 'place' && event.side === 'enemy'));
});

test('draw respects the six-card hand limit and consumes one deck card', () => {
  const state = fixture();
  const denied = drawCard(state, 'player');
  assert.equal(denied.events.length, 0);
  const troop = state.players.player.hand.find((card) => getCardDefinition(card.definitionId).kind === 'troop');
  if (!troop) throw new Error('A fixture determinística precisa conter uma tropa na mão.');
  const placed = placeCard(state, 'player', troop.instanceId, 0);
  const drawn = drawCard(placed.state, 'player');
  assert.equal(drawn.state.players.player.hand.length, 6);
  assert.equal(drawn.state.players.player.deck.length, 17);
  assert.equal(drawn.events[0]?.type, 'draw');
});

test('troops place into empty slots; spells cannot be placed as troops and occupied slots are safe', () => {
  const state = fixture();
  const troop = makeCard('player', 'solemn-guardian', 'unit-a');
  const spell = makeCard('player', 'wandering-flame', 'spell-a');
  state.players.player.hand = [troop, spell];
  const placed = placeCard(state, 'player', troop.instanceId, 2);
  assert.equal(placed.state.players.player.slots[2]?.instanceId, troop.instanceId);
  assert.equal(placed.state.players.player.slots[2]?.nextAttackAtMs, 3000);
  assert.equal(placeCard(placed.state, 'player', spell.instanceId, 1).events.length, 0);
  assert.equal(placeCard(placed.state, 'player', spell.instanceId, 2).events.length, 0);
});

test('troops move and can return to hand only while there is room', () => {
  const state = fixture();
  state.players.player.hand = [makeCard('player', 'solemn-guardian', 'unit-a')];
  const placed = placeCard(state, 'player', 'unit-a', 1).state;
  const moved = moveTroop(placed, 'player', 1, 4);
  assert.equal(moved.state.players.player.slots[4]?.instanceId, 'unit-a');
  assert.equal(moved.state.players.player.slots[4]?.nextAttackAtMs, 3000);
  assert.equal(moved.state.players.player.slots[1], null);
  const returned = returnTroop(moved.state, 'player', 4);
  assert.equal(returned.state.players.player.hand[0]?.instanceId, 'unit-a');
  returned.state.players.player.hand = Array.from({ length: 6 }, (_, index) => makeCard('player', 'solemn-guardian', `hand-${index}`));
  returned.state.players.player.slots[4] = makeCard('player', 'solemn-guardian', 'unit-b');
  assert.equal(returnTroop(returned.state, 'player', 4).events.length, 0);
});

test('sigils occupy separate spaces and can be revealed without combat triggers', () => {
  const state = fixture();
  state.players.player.hand = [makeCard('player', 'eclipse-seal', 'seal-a')];
  const placed = placeSigil(state, 'player', 'seal-a', 1);
  assert.equal(placed.state.players.player.sigils[1]?.revealed, false);
  const revealed = revealSigil(placed.state, 'player', 1);
  assert.equal(revealed.state.players.player.sigils[1]?.revealed, true);
  assert.equal(revealed.events[0]?.type, 'reveal');
});

test('front row protects the rear row in the same column for both mirrored sides', () => {
  const state = fixture();
  state.players.enemy.slots[3] = makeCard('enemy', 'solemn-guardian', 'enemy-front');
  state.players.enemy.slots[0] = makeCard('enemy', 'moss-colossus', 'enemy-rear');
  assert.deepEqual(chooseAttackTarget(state, 'player', 0), { side: 'enemy', slot: 3, direct: false });
  state.players.enemy.slots[3] = null;
  assert.deepEqual(chooseAttackTarget(state, 'player', 0), { side: 'enemy', slot: 0, direct: false });
  assert.deepEqual(chooseAttackTarget(state, 'player', 1), { side: 'enemy', direct: true });
  state.players.player.slots[1] = makeCard('player', 'solemn-guardian', 'player-rear');
  state.players.player.slots[4] = makeCard('player', 'solemn-guardian', 'player-front');
  assert.deepEqual(chooseAttackTarget(state, 'enemy', 4), { side: 'player', slot: 1, direct: false });
});

test('scheduled attacks target a same-column troop before rear troops, otherwise damage life directly', () => {
  const state = fixture();
  state.players.player.slots[0] = makeCard('player', 'solemn-guardian', 'attacker', 4, 1000);
  state.players.enemy.slots[3] = makeCard('enemy', 'astral-fox', 'front', 2, 20_000);
  state.players.enemy.slots[0] = makeCard('enemy', 'moss-colossus', 'rear', 6, 20_000);
  state.clockMs = 1000;
  const hit = advanceTime(state, 1);
  assert.equal(hit.state.players.enemy.slots[3], null);
  assert.equal(hit.state.players.enemy.slots[0]?.health, 6);
  assert.equal(hit.events.some((event) => event.type === 'damage' && event.destroyed), true);
  hit.state.players.enemy.slots[0] = null;
  hit.state.clockMs = 4000;
  const direct = advanceTime(hit.state, 1);
  assert.equal(direct.state.players.enemy.life, 18);
  assert.equal(direct.events[0]?.type, 'attack');
});

test('each troop keeps an independent attack timer', () => {
  const state = fixture();
  state.players.player.slots[0] = makeCard('player', 'solemn-guardian', 'early', 4, 1000);
  state.players.enemy.slots[3] = makeCard('enemy', 'moss-colossus', 'later', 6, 20_000);
  state.players.enemy.slots[4] = makeCard('enemy', 'astral-fox', 'other-column', 2, 2000);
  const first = advanceTime(state, 1000);
  assert.equal(first.events.filter((event) => event.type === 'attack').length, 1);
  assert.equal(first.state.players.player.slots[0]?.nextAttackAtMs, 4000);
  assert.equal(first.state.players.enemy.slots[3]?.health, 4);
  const second = advanceTime(first.state, 1000);
  assert.equal(second.events.filter((event) => event.type === 'attack').length, 1);
  assert.equal(second.events.find((event) => event.type === 'attack')?.side, 'enemy');
  assert.equal(second.state.players.player.life, 17);
  const third = advanceTime(second.state, 2000);
  assert.equal(third.state.players.enemy.slots[3]?.health, 2);
  const fourth = advanceTime(third.state, 3000);
  assert.equal(fourth.state.players.enemy.slots[3], null);
});

test('the attack resolver rejects attacks before a troop timer is due', () => {
  const state = fixture();
  state.players.player.slots[0] = makeCard('player', 'solemn-guardian', 'not-ready', 4, 3000);
  const beforeDue = advanceTime(state, 2999);
  assert.deepEqual(beforeDue.events.filter((event) => event.type === 'attack'), []);
  assert.equal('resolveAttack' in gameEngineApi, false, 'engine API must not expose an immediate attack action');
  assert.equal('resolveDueAttacks' in gameEngineApi, false, 'due-attack processing must remain private to the simulation');
  const ready = advanceTime(beforeDue.state, 1);
  assert.equal(ready.events.filter((event) => event.type === 'attack').length, 1);
});

test('all attacks at one timestamp use the same field snapshot and can destroy each other', () => {
  const state = fixture();
  state.players.player.slots[0] = makeCard('player', 'astral-fox', 'player-fox', 2, 1000);
  state.players.enemy.slots[3] = makeCard('enemy', 'astral-fox', 'enemy-fox', 2, 1000);
  const result = advanceTime(state, 1000);
  assert.equal(result.events.filter((event) => event.type === 'attack').length, 2);
  assert.equal(result.state.players.player.slots[0], null);
  assert.equal(result.state.players.enemy.slots[3], null);
  const damages = result.events.filter((event) => event.type === 'damage');
  assert.equal(damages.length, 2);
  assert.ok(damages.every((event) => event.type === 'damage' && event.destroyed && event.amount === 3));
});

test('simultaneous lethal direct attacks produce a draw after both damage totals are applied', () => {
  const state = fixture();
  state.players.player.life = 2;
  state.players.enemy.life = 2;
  state.players.player.slots[0] = makeCard('player', 'amber-phoenix', 'player-finisher', 3, 1000);
  state.players.enemy.slots[4] = makeCard('enemy', 'amber-phoenix', 'enemy-finisher', 3, 1000);
  const result = advanceTime(state, 1000);
  assert.equal(result.state.phase, 'finished');
  assert.equal(result.state.winner, null);
  assert.equal(result.state.players.player.life, 0);
  assert.equal(result.state.players.enemy.life, 0);
  assert.ok(result.events.some((event) => event.type === 'game-draw'));
});

test('same-instant AI action is explicitly resolved before attacks', () => {
  const state = fixture();
  state.aiStarted = true;
  state.clockMs = 999;
  state.nextAiAtMs = 1000;
  state.players.player.slots[0] = makeCard('player', 'astral-fox', 'player-fox', 2, 1000);
  state.players.enemy.slots[3] = makeCard('enemy', 'moss-colossus', 'enemy-guard', 6, 1000);
  state.players.enemy.hand = [makeCard('enemy', 'wandering-flame', 'ai-flame')];
  state.players.enemy.deck = [];
  const result = advanceTime(state, 1);
  const spellIndex = result.events.findIndex((event) => event.type === 'spell');
  const attackIndex = result.events.findIndex((event) => event.type === 'attack');
  assert.ok(spellIndex >= 0 && attackIndex > spellIndex);
  assert.equal(result.state.players.player.slots[0], null);
  assert.equal(result.events.filter((event) => event.type === 'attack').length, 1);
  assert.equal(result.events.find((event) => event.type === 'attack')?.side, 'enemy');
});

test('returning and redeploying a troop starts a fresh attack timer', () => {
  const state = fixture();
  const unit = makeCard('player', 'solemn-guardian', 'timer-reset', 4, 0);
  state.players.player.hand = [unit];
  state.clockMs = 500;
  const placed = placeCard(state, 'player', unit.instanceId, 0);
  assert.equal(placed.state.players.player.slots[0]?.nextAttackAtMs, 3500);
  const returned = returnTroop(placed.state, 'player', 0);
  assert.equal(returned.state.players.player.hand[0]?.nextAttackAtMs, 0);
  const redeployed = placeCard(returned.state, 'player', unit.instanceId, 1);
  assert.equal(redeployed.state.players.player.slots[1]?.nextAttackAtMs, 3500);
});

test('Chama Errante damages a valid enemy unit or enemy life and rejects friendly targets', () => {
  const state = fixture();
  state.players.player.hand = [makeCard('player', 'wandering-flame', 'flame')];
  state.players.enemy.slots[0] = makeCard('enemy', 'moss-colossus', 'target', 5);
  const rejected = castSpell(state, 'player', 'flame', { kind: 'unit', side: 'player', slot: 0 });
  assert.equal(rejected.events.length, 0);
  const cast = castSpell(state, 'player', 'flame', { kind: 'unit', side: 'enemy', slot: 0 });
  assert.equal(cast.state.players.enemy.slots[0]?.health, 3);
  cast.state.players.player.hand = [makeCard('player', 'wandering-flame', 'flame-2')];
  const direct = castSpell(cast.state, 'player', 'flame-2', { kind: 'life', side: 'enemy' });
  assert.equal(direct.state.players.enemy.life, 18);
  const directDamageEvent = direct.events.find((event) => event.type === 'life-damage');
  assert.equal(directDamageEvent?.type, 'life-damage');
  if (directDamageEvent?.type === 'life-damage') assert.ok(directDamageEvent.amount >= 0);
});

test('Pulso Rúnico heals allies and player life without exceeding maximum', () => {
  const state = fixture();
  state.players.player.life = 17;
  state.players.player.hand = [makeCard('player', 'runic-pulse', 'pulse')];
  const direct = castSpell(state, 'player', 'pulse', { kind: 'life', side: 'player' });
  assert.equal(direct.state.players.player.life, 19);
  const lifeHealEvent = direct.events.find((event) => event.type === 'life-heal');
  assert.equal(lifeHealEvent?.type, 'life-heal');
  if (lifeHealEvent?.type === 'life-heal') assert.ok(lifeHealEvent.amount >= 0);
  direct.state.players.player.hand = [makeCard('player', 'runic-pulse', 'pulse-2')];
  direct.state.players.player.slots[0] = makeCard('player', 'solemn-guardian', 'wounded', 2);
  const unit = castSpell(direct.state, 'player', 'pulse-2', { kind: 'unit', side: 'player', slot: 0 });
  assert.equal(unit.state.players.player.slots[0]?.health, 4);
  const healEvent = unit.events.find((event) => event.type === 'heal');
  assert.equal(healEvent?.type, 'heal');
  if (healEvent?.type === 'heal') assert.ok(healEvent.amount >= 0);
  assert.equal(unit.events.some((event) => event.type === 'damage' && event.amount < 0), false);
  unit.state.players.player.hand = [makeCard('player', 'runic-pulse', 'pulse-3')];
  unit.state.players.player.life = 20;
  assert.equal(castSpell(unit.state, 'player', 'pulse-3', { kind: 'life', side: 'player' }).events.length, 0);
});

test('all gameplay actions, including revealing a sigil, are rejected after the result', () => {
  const state = fixture();
  state.players.player.sigils[0] = makeCard('player', 'eclipse-seal', 'finished-sigil');
  const finished = endWithWinner(state, 'enemy').state;
  const result = revealSigil(finished, 'player', 0);
  assert.equal(result.events.length, 0);
  assert.equal(result.state.players.player.sigils[0]?.revealed, false);
  assert.equal(drawCard(finished, 'player').events.length, 0);
  assert.equal(moveTroop(finished, 'player', 0, 1).events.length, 0);
  assert.equal(placeCard(finished, 'player', 'missing', 0).events.length, 0);
  assert.equal(placeSigil(finished, 'player', 'missing', 0).events.length, 0);
  assert.equal(returnTroop(finished, 'player', 0).events.length, 0);
  assert.equal(castSpell(finished, 'player', 'missing', { kind: 'life', side: 'enemy' }).events.length, 0);
});

test('field topology and experimental balance are validated against the supported UI and catalog', () => {
  assert.deepEqual([topology.rows, topology.columns, boardSlotCount, sigilSlotCount], [2, 3, 6, 2]);
  assert.equal(balance.deckSize, cardDefinitions.length * balance.copiesPerDefinition);
  assert.throws(() => validateExperimentalBalance({ ...balance, deckSize: 23 }, cardDefinitions.length), /deckSize é uma restrição declarada/);
  assert.throws(() => validateExperimentalBalance({ ...balance, fieldTopology: { ...topology, columns: 4 } }, cardDefinitions.length), /Topologia incompatível/);
  assert.throws(() => validateExperimentalBalance({ ...balance, fieldTopology: { ...topology, frontRow: { player: 9, enemy: 1 } } }, cardDefinitions.length), /orientação frontRow/);
  assert.throws(() => validateExperimentalBalance({ ...balance, fieldTopology: { ...topology, frontRow: { player: 0, enemy: 0 } } }, cardDefinitions.length), /precisam ser opostas/);
});

test('basic AI draws and deploys using the same validated engine actions', () => {
  const state = fixture();
  state.players.enemy.hand = [];
  state.players.enemy.deck = [makeCard('enemy', 'solemn-guardian', 'ai-troop')];
  const result = takeAiAction(state);
  assert.ok(result.events.some((event) => event.type === 'place'));
  assert.ok(result.events.some((event) => event.type === 'draw'));
  assert.equal(result.state.players.enemy.hand.length, 0);
  assert.equal(result.state.players.enemy.slots.filter(Boolean).length, 1);
  assert.equal(result.state.players.player.hand.length, 6);
});

test('life reaching zero ends the game and reports the correct winner', () => {
  const state = fixture();
  state.players.enemy.life = 1;
  state.players.player.slots[0] = makeCard('player', 'amber-phoenix', 'finisher', 2, 0);
  state.clockMs = 1000;
  const result = advanceTime(state, 1000);
  assert.equal(result.state.phase, 'finished');
  assert.equal(result.state.winner, 'player');
  assert.equal(result.state.players.enemy.life, 0);
});

test('restart factory creates fresh life, board, hand, and deterministic deck', () => {
  const first = createGame(333);
  const second = createGame(333);
  first.players.player.life = 4;
  first.players.player.slots[0] = makeCard('player', 'solemn-guardian', 'old');
  const restarted = createGame(333);
  assert.equal(restarted.players.player.life, 20);
  assert.equal(restarted.players.player.slots.filter(Boolean).length, 0);
  assert.equal(restarted.players.player.hand[0]?.definitionId, second.players.player.hand[0]?.definitionId);
});
