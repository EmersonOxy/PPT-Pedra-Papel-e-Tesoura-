const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const studioRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(studioRoot, '..');
const sceneCatalog = require('../scenes.json');
const gameCatalog = require('../../config/editor-elements.schema.json');
const gameHtml = fs.readFileSync(path.join(repositoryRoot, 'index.html'), 'utf8');
const gameView = fs.readFileSync(path.join(repositoryRoot, 'src/game/ui/game-view.js'), 'utf8');
const gameUi = fs.readFileSync(path.join(repositoryRoot, 'src/game/ui/game-ui.js'), 'utf8');
const rules = fs.readFileSync(path.join(repositoryRoot, 'src/game/core/rules.js'), 'utf8');

test('scene catalog exposes only actual menu, combat, reward, and result states', () => {
  assert.equal(sceneCatalog.version, 1);
  assert.deepEqual(sceneCatalog.scenes.map((scene) => scene.id), [
    'menu', 'combat', 'battle-win', 'battle-loss', 'reward', 'match-win', 'match-loss', 'timeout-loss',
  ]);
  assert.equal((gameHtml.match(/id="menu-screen"/g) || []).length, 1);
  assert.equal((gameHtml.match(/id="game-screen"/g) || []).length, 1);
  assert.match(gameView, /Você venceu o combate!/);
  assert.match(gameView, /O inimigo venceu o combate!/);
  assert.match(gameView, /Você venceu a partida!/);
  assert.match(gameView, /O inimigo venceu a partida!/);
  assert.match(gameView, /Luck Block:/);
  assert.match(gameView, /finishReason === 'timeout'/);
  assert.match(rules, /POINTS_FOR_PRIZE = 3/);
  assert.match(rules, /POINTS_TO_WIN = 10/);
  assert.match(rules, /finishReason='timeout'/);
  assert.match(gameUi, /showEnding\(turn\.battleResult\)/);
});

test('each scene lists unique registered targets and deterministic, bounded fixtures', () => {
  const ids = new Set(gameCatalog.elements.map((element) => element.id));
  const sceneIds = new Set();
  for (const scene of sceneCatalog.scenes) {
    assert.match(scene.id, /^[a-z][a-z0-9-]+$/);
    assert.equal(sceneIds.has(scene.id), false, `ID duplicado: ${scene.id}`);
    sceneIds.add(scene.id);
    assert.equal(typeof scene.label, 'string');
    assert.equal(typeof scene.description, 'string');
    assert.ok(['menu', 'combat', 'battle-result', 'match-result'].includes(scene.fixture.kind));
    assert.equal(new Set(scene.elementIds).size, scene.elementIds.length, `Camadas duplicadas em ${scene.id}`);
    assert.ok(scene.elementIds.every((id) => ids.has(id)), `Camada não registrada em ${scene.id}`);
    assert.ok(scene.elementIds.length > 0, `Estado sem elementos listados: ${scene.id}`);
  if (scene.fixture.kind === 'menu') assert.deepEqual(scene.elementIds, ['menu.card', 'game.title', 'menu.start']);
    else {
      assert.ok(scene.fixture.playerPoints >= 0 && scene.fixture.playerPoints <= 10);
      assert.ok(scene.fixture.enemyPoints >= 0 && scene.fixture.enemyPoints <= 10);
      assert.ok(scene.fixture.playerHp >= 0 && scene.fixture.playerHp <= 100);
      assert.ok(scene.fixture.enemyHp >= 0 && scene.fixture.enemyHp <= 100);
      assert.ok(['rock', 'paper', 'scissors'].includes(scene.fixture.playerSign));
      assert.ok(['rock', 'paper', 'scissors'].includes(scene.fixture.enemySign));
    }
  }
  for (const id of ['menu.card', 'menu.start', 'game.title', 'arena.background']) {
    const element = gameCatalog.elements.find((entry) => entry.id === id);
    assert.ok(element?.geometry, `Geometria compatível ausente em ${id}`);
    assert.equal(element.geometry.binding, 'css-flow-box-v1');
    assert.deepEqual(element.geometry.supports, ['move', 'resize']);
    assert.equal(element.geometry.units, 'css-px');
    assert.equal(element.geometry.responsive, true);
  }
});
