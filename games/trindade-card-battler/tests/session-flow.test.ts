import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMatchFlow,
  beginDemoMatchSearch,
  cancelDemoMatchSearch,
  createMatchFlow,
  sessionConfig,
  validateExperimentalSessionConfig,
} from '../src/game/session-flow.ts';

test('match search is deterministic, cancellable before a match is found, and ignores repeated starts', () => {
  const idle = createMatchFlow();
  const searching = beginDemoMatchSearch(idle);
  assert.equal(searching.phase, 'searching');
  assert.equal(beginDemoMatchSearch(searching), searching);
  const partial = advanceMatchFlow(searching, sessionConfig.matchmakingSearchMs - 1);
  assert.equal(partial.state.phase, 'searching');
  assert.deepEqual(partial.events, []);
  const cancelled = cancelDemoMatchSearch(partial.state);
  assert.equal(cancelled.phase, 'idle');
  assert.equal(cancelDemoMatchSearch(cancelled), cancelled);
  const found = advanceMatchFlow(searching, sessionConfig.matchmakingSearchMs);
  assert.equal(found.state.phase, 'found');
  assert.deepEqual(found.events, ['opponent-found']);
  assert.equal(cancelDemoMatchSearch(found.state), found.state);
});

test('a found opponent gets a five-second countdown before the curtain transition', () => {
  let state = beginDemoMatchSearch(createMatchFlow());
  state = advanceMatchFlow(state, sessionConfig.matchmakingSearchMs).state;
  state = advanceMatchFlow(state, sessionConfig.opponentFoundMessageMs).state;
  assert.equal(state.phase, 'countdown');
  const before = advanceMatchFlow(state, sessionConfig.preMatchCountdownMs - 1);
  assert.equal(before.state.phase, 'countdown');
  assert.deepEqual(before.events, []);
  const ended = advanceMatchFlow(before.state, 1);
  assert.equal(ended.state.phase, 'transition');
  assert.deepEqual(ended.events, ['transition-start']);
});

test('the arena mounts only when the curtain covers the screen and transition completes once', () => {
  let state = beginDemoMatchSearch(createMatchFlow());
  state = advanceMatchFlow(state, sessionConfig.matchmakingSearchMs + sessionConfig.opponentFoundMessageMs + sessionConfig.preMatchCountdownMs).state;
  const beforeCover = advanceMatchFlow(state, sessionConfig.transitionCoverAtMs - 1);
  assert.equal(beforeCover.state.arenaMounted, false);
  assert.deepEqual(beforeCover.events, []);
  const covered = advanceMatchFlow(beforeCover.state, 1);
  assert.equal(covered.state.arenaMounted, true);
  assert.deepEqual(covered.events, ['mount-arena']);
  const uncovered = advanceMatchFlow(covered.state, sessionConfig.transitionDurationMs - sessionConfig.transitionCoverAtMs);
  assert.equal(uncovered.state.phase, 'preparation');
  assert.deepEqual(uncovered.events, ['transition-complete']);
  assert.deepEqual(advanceMatchFlow(uncovered.state, 250).events, []);
});

test('session configuration rejects invalid durations, unknown card IDs, and incomplete action permissions', () => {
  assert.equal(sessionConfig.matchmakingSearchMs, 900);
  assert.throws(() => validateExperimentalSessionConfig({ ...sessionConfig, transitionCoverAtMs: sessionConfig.transitionDurationMs }), /precisa ocorrer antes/);
  assert.throws(() => validateExperimentalSessionConfig({ ...sessionConfig, preparationActions: { ...sessionConfig.preparationActions, unknown: sessionConfig.preparationActions['solemn-guardian'] } }), /exatamente os IDs/);
  const partial = { ...sessionConfig.preparationActions, 'solemn-guardian': { ...sessionConfig.preparationActions['solemn-guardian'] } };
  delete (partial['solemn-guardian'] as Partial<typeof partial['solemn-guardian']>).reveal;
  assert.throws(() => validateExperimentalSessionConfig({ ...sessionConfig, preparationActions: partial }), /ações de preparação inválidas/i);
});
