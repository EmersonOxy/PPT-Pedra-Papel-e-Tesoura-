import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const htmlPath = resolve(fileURLToPath(new URL('../../reference/Jogar-Trindade-transicao-preta.baseline.html', import.meta.url)));
const html = await readFile(htmlPath, 'utf8');
const scriptStart = html.indexOf("<script>\n(() => {\n'use strict';");
const rulesStart = html.indexOf('const SIGNS =', scriptStart);
const domStart = html.indexOf('const $=id=>document.getElementById(id);', rulesStart);
assert.ok(scriptStart >= 0 && rulesStart > scriptStart && domStart > rulesStart, 'Baseline structure changed; re-review the extraction boundary.');

const rulesSource = html.slice(rulesStart, domStart);
const expose = `\nglobalThis.__characterization = { SIGNS, POWERS, MAX_HP, DAMAGE, CRIT_DAMAGE, POINTS_FOR_PRIZE, POINTS_TO_WIN, TURN_SECONDS, MAX_MISSES, outcome, createGame, powerCount, activateAbility, chooseEnemySign, chooseEnemyAbility, awardBattle, play, nextBattle, missChoice };`;
const context = { Math };
runInNewContext(`${rulesSource}${expose}`, context, { timeout: 1000, filename: 'original-game-rules.js' });
const rules = context.__characterization;
const testCases = [];
const test = (name, fn) => {
  fn();
  testCases.push(name);
};
const sequence = (...values) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

test('RPS outcome matrix and invalid-input rejection', () => {
  const expected = [
    ['draw', 'loss', 'win'],
    ['win', 'draw', 'loss'],
    ['loss', 'win', 'draw'],
  ];
  for (let p = 0; p < rules.SIGNS.length; p++) {
    for (let e = 0; e < rules.SIGNS.length; e++) assert.equal(rules.outcome(rules.SIGNS[p], rules.SIGNS[e]), expected[p][e]);
  }
  assert.throws(() => rules.outcome('invalid', 'rock'), /Jogada inválida/);
});

test('initial state and core constants', () => {
  const game = rules.createGame();
  assert.equal(game.hp, 100);
  assert.equal(game.enemyHp, 100);
  assert.equal(game.phase, 'playing');
  assert.equal(game.battle, 1);
  assert.equal(rules.DAMAGE, 20);
  assert.equal(rules.CRIT_DAMAGE, 30);
  assert.equal(rules.POINTS_FOR_PRIZE, 3);
  assert.equal(rules.POINTS_TO_WIN, 10);
  assert.equal(rules.TURN_SECONDS, 5);
  assert.equal(rules.MAX_MISSES, 3);
});

test('healing range, max-HP cap, and full-health rejection', () => {
  const game = rules.createGame();
  game.inventory.player.push('heal', 'heal');
  assert.equal(rules.activateAbility(game, 'player', 'heal', () => 0), null);
  assert.equal(game.inventory.player.length, 2);
  game.hp = 70;
  assert.deepEqual(JSON.parse(JSON.stringify(rules.activateAbility(game, 'player', 'heal', () => 0))), { kind: 'heal', rolled: 10, restored: 10 });
  game.hp = 90;
  assert.deepEqual(JSON.parse(JSON.stringify(rules.activateAbility(game, 'player', 'heal', () => 0.999))), { kind: 'heal', rolled: 50, restored: 10 });
  assert.equal(game.hp, 100);
});

test('buff activation consumes inventory, rejects stacking, and expires on draw', () => {
  const game = rules.createGame();
  game.inventory.player.push('defense');
  assert.deepEqual(JSON.parse(JSON.stringify(rules.activateAbility(game, 'player', 'defense'))), { kind: 'defense' });
  assert.equal(rules.activateAbility(game, 'player', 'critical'), null);
  game.inventory.enemy.push('critical');
  rules.activateAbility(game, 'enemy', 'critical');
  const turn = rules.play(game, 'rock', sequence(0));
  assert.equal(turn.result, 'draw');
  assert.equal(turn.damage, 0);
  assert.equal(game.hp, 100);
  assert.equal(game.enemyHp, 100);
  assert.equal(game.activeBuff.player, null);
  assert.equal(game.activeBuff.enemy, null);
  assert.deepEqual(Array.from(game.playerHistory), ['rock']);
});

test('critical damage and defense reduction are applied to the next hand only', () => {
  const critical = rules.createGame();
  critical.inventory.player.push('critical');
  rules.activateAbility(critical, 'player', 'critical');
  const criticalTurn = rules.play(critical, 'paper', sequence(0));
  assert.equal(criticalTurn.result, 'win');
  assert.equal(criticalTurn.damage, 30);
  assert.equal(critical.enemyHp, 70);
  assert.equal(critical.activeBuff.player, null);

  const defense = rules.createGame();
  defense.inventory.player.push('defense');
  rules.activateAbility(defense, 'player', 'defense');
  const defenseTurn = rules.play(defense, 'rock', sequence(0.34));
  assert.equal(defenseTurn.result, 'loss');
  assert.equal(defenseTurn.damage, 10);
  assert.equal(defense.hp, 90);
});

test('three misses finish the match; earlier misses remain available to UI auto-choice flow', () => {
  const game = rules.createGame();
  assert.equal(rules.missChoice(game), false);
  assert.equal(rules.missChoice(game), false);
  assert.equal(game.misses, 2);
  assert.equal(game.phase, 'playing');
  assert.equal(rules.missChoice(game), true);
  assert.equal(game.phase, 'finished');
  assert.equal(game.matchWinner, 'enemy');
  assert.equal(game.finishReason, 'timeout');
  assert.equal(rules.missChoice(game), false);
});

test('battle award transfers inventory and grants a deterministic prize at 3 points', () => {
  const game = rules.createGame();
  game.playerPoints = 2;
  game.inventory.enemy.push('defense', 'critical');
  const result = rules.awardBattle(game, 'player', () => 0);
  assert.equal(game.playerPoints, 3);
  assert.deepEqual(Array.from(result.transferred), ['defense', 'critical']);
  assert.equal(result.unlocked, 'heal');
  assert.deepEqual(Array.from(game.inventory.player), ['defense', 'critical', 'heal']);
  assert.equal(game.inventory.enemy.length, 0);
  assert.equal(game.phase, 'won');
});

test('tenth point ends the match and does not grant another prize', () => {
  const game = rules.createGame();
  game.playerPoints = 9;
  const result = rules.awardBattle(game, 'player', () => 0);
  assert.equal(result.unlocked, null);
  assert.equal(game.phase, 'finished');
  assert.equal(game.matchWinner, 'player');
  assert.equal(game.finishReason, 'points');
});

test('next battle refills HP while retaining score and inventory', () => {
  const game = rules.createGame();
  game.phase = 'won';
  game.hp = 45;
  game.enemyHp = 0;
  game.playerPoints = 4;
  game.inventory.player.push('heal');
  game.activeBuff.player = 'defense';
  assert.equal(rules.nextBattle(game), true);
  assert.equal(game.hp, 100);
  assert.equal(game.enemyHp, 100);
  assert.equal(game.playerPoints, 4);
  assert.deepEqual(Array.from(game.inventory.player), ['heal']);
  assert.equal(game.activeBuff.player, null);
  assert.equal(game.battle, 2);
  assert.equal(rules.nextBattle(game), false);
});

test('enemy choice is based on stored history and seeded randomness', () => {
  const game = rules.createGame();
  game.playerHistory.push('rock', 'paper', 'rock', 'paper');
  const first = rules.chooseEnemySign(game, sequence(0.5, 0.1));
  const second = rules.chooseEnemySign(game, sequence(0.5, 0.1));
  assert.equal(first, second);
  assert.ok(rules.SIGNS.includes(first));
});

process.stdout.write(`Baseline characterization: ${testCases.length} cenários aprovados\n`);
for (const name of testCases) process.stdout.write(`  OK ${name}\n`);
