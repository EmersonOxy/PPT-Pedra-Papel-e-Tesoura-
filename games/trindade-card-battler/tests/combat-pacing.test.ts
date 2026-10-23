import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { cardDefinitions, getCardDefinition } from '../src/game/cards.ts';
import { attackIntervalFor } from '../src/game/config.ts';
import { createGame } from '../src/game/engine.ts';
import { advanceTime } from '../src/game/simulation.ts';
import { attackProfileClass, attackProjectileClass, cooldownSweepDegrees, handFanSpacing, shouldHighlightDeck } from '../src/ui/combat-presentation.ts';
import type { CardInstance, GameState, Side } from '../src/game/types.ts';

const previousStats: Record<string, { attack: number; health: number }> = {
  'solemn-guardian': { attack: 2, health: 4 }, 'astral-fox': { attack: 3, health: 2 },
  'moss-colossus': { attack: 2, health: 6 }, 'amber-phoenix': { attack: 5, health: 2 },
  'veil-oracle': { attack: 3, health: 3 }, 'vesper-blade': { attack: 4, health: 2 },
  'ember-knight': { attack: 4, health: 3 },
};

function makeUnit(side: Side, id: string, definitionId: string, nextAttackAtMs: number): CardInstance {
  return { instanceId: id, owner: side, definitionId, health: getCardDefinition(definitionId).maxHealth, nextAttackAtMs, revealed: true };
}

function duelEliminationTime(playerId: string, enemyId: string): number {
  const state: GameState = createGame(19);
  state.aiStarted = false; state.nextAiAtMs = Number.POSITIVE_INFINITY;
  const p = getCardDefinition(playerId); const e = getCardDefinition(enemyId);
  state.players.player.slots[0] = makeUnit('player', 'p', playerId, attackIntervalFor(playerId));
  state.players.enemy.slots[3] = makeUnit('enemy', 'e', enemyId, attackIntervalFor(enemyId));
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const player = state.players.player.slots[0]; const enemy = state.players.enemy.slots[3];
    if (!player || !enemy) return state.clockMs;
    const nextAt = Math.min(player.nextAttackAtMs, enemy.nextAttackAtMs);
    const advanced = advanceTime(state, nextAt - state.clockMs);
    Object.assign(state, advanced.state);
  }
  throw new Error(`Duel did not end: ${p.name} vs ${e.name}`);
}

test('every troop has a reusable attack profile and the four profiles are represented', () => {
  const troops = cardDefinitions.filter((card) => card.kind === 'troop');
  const profiles = new Set(troops.map((card) => card.attackAnimationProfile));
  assert.equal(troops.every((card) => card.attackAnimationProfile), true);
  assert.deepEqual([...profiles].sort(), ['advance', 'impact', 'pulse', 'spin']);
  assert.equal(attackProfileClass('advance'), 'attack-profile--advance');
  assert.equal(attackProfileClass('impact'), 'attack-profile--impact');
  assert.equal(attackProfileClass('spin'), 'attack-profile--spin');
  assert.equal(attackProfileClass('pulse'), 'attack-profile--pulse');
  assert.equal(attackProjectileClass('player', 'pulse'), 'combat-projectile combat-projectile--player combat-projectile--profile-pulse');
  assert.equal(attackProjectileClass('enemy', 'advance'), 'combat-projectile combat-projectile--enemy');
});

test('deck suggestion appears only when a manual draw is available and the hand lacks a troop', () => {
  const base = { phase: 'playing', handCount: 2, handLimit: 6, deckCount: 8, hasTroopInHand: false };
  assert.equal(shouldHighlightDeck(base), true);
  assert.equal(shouldHighlightDeck({ ...base, handCount: 0, hasTroopInHand: false }), true);
  assert.equal(shouldHighlightDeck({ ...base, hasTroopInHand: true }), false);
  assert.equal(shouldHighlightDeck({ ...base, handCount: 6 }), false);
  assert.equal(shouldHighlightDeck({ ...base, deckCount: 0 }), false);
  assert.equal(shouldHighlightDeck({ ...base, phase: 'starting' }), false);
});

test('the six-card mobile fan keeps every card inside its available width', () => {
  const width = 299; const cardWidth = 95; const count = 6;
  const spacing = handFanSpacing(width, count, cardWidth);
  assert.ok(cardWidth + spacing * (count - 1) + 12 <= width + 0.001);
  assert.equal(handFanSpacing(width, 1, cardWidth), 0);
});

test('cooldown wipe starts fully shaded and clears clockwise as the troop becomes ready', () => {
  assert.equal(cooldownSweepDegrees(6500, 6500), 0);
  assert.equal(cooldownSweepDegrees(3250, 6500), 180);
  assert.equal(cooldownSweepDegrees(0, 6500), 360);
  assert.equal(cooldownSweepDegrees(8000, 6500), 0);
  assert.equal(cooldownSweepDegrees(100, 0), 360);
});

test('presentation stylesheet includes all attack profiles, impact feedback, field tilt, and reduced-motion handling', async () => {
  const css = await readFile(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
  const homeCss = await readFile(new URL('../src/ui/home.css', import.meta.url), 'utf8');
  for (const profile of ['advance', 'impact', 'spin', 'pulse']) assert.ok(css.includes(`attack-profile--${profile}`));
  assert.ok(css.includes('.battle-card.is-hit .damage-aura'));
  assert.ok(css.includes('.battle-card.destruction-ghost.is-destroyed'));
  assert.ok(css.includes('.attack-cooldown-shade.is-cooling'));
  assert.ok(css.includes('conic-gradient(from 0deg'));
  assert.ok(css.includes('--field-tilt-angle'));
  assert.match(css, /--field-tilt-angle:\s*14deg/);
  assert.match(css, /--field-tilt-opponent-angle:\s*22deg/);
  assert.match(css, /\.field-band\.enemy\s*\{\s*transform:\s*perspective\(var\(--field-perspective\)\) rotateX\(var\(--field-tilt-opponent-angle\)\)/);
  assert.match(css, /\.field-band\.player\s*\{\s*transform:\s*perspective\(var\(--field-perspective\)\) rotateX\(var\(--field-tilt-angle\)\)/);
  assert.match(homeCss, /\.field-band\.enemy::after[^}]*transform:\s*none/);
  assert.doesNotMatch(homeCss, /\.game-shell\.is-preparing \.field-band\.enemy \.battle-grid[^}]*blur\(/);
  assert.ok(css.includes('prefers-reduced-motion: reduce'));
});

test('representative deterministic troop duels survive longer under the experimental pacing profile', () => {
  const troops = cardDefinitions.filter((card) => card.kind === 'troop');
  let oldTotal = 0; let newTotal = 0; let matchups = 0;
  for (const player of troops) for (const enemy of troops) {
    const oldP = previousStats[player.id]!; const oldE = previousStats[enemy.id]!;
    const oldTime = Math.min(Math.ceil(oldE.health / oldP.attack), Math.ceil(oldP.health / oldE.attack)) * 5000;
    oldTotal += oldTime;
    newTotal += duelEliminationTime(player.id, enemy.id);
    matchups += 1;
  }
  const oldAverage = oldTotal / matchups; const newAverage = newTotal / matchups;
  console.log(`Pacing experiment: ${matchups} matchups; average first-elimination time ${Math.round(oldAverage)} ms -> ${Math.round(newAverage)} ms (+${Math.round((newAverage / oldAverage - 1) * 100)}%).`);
  assert.equal(matchups, troops.length ** 2);
  assert.ok(newAverage > oldAverage);
});
