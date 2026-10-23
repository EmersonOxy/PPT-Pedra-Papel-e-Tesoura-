import { attackIntervalFor, balance, boardSlotCount, initialAttackDelayFor, sigilSlotCount, topology } from './config.ts';
import { isAttackTargetExposed, oppositeSide } from './targeting.ts';
import { isPreparationActionAllowed, sessionConfig } from './session-flow.ts';
import { cardDefinitions, getCardDefinition } from './cards.ts';
import type { CardInstance, GameEvent, GameState, PlayerState, Side, SpellTarget, Transition } from './types.ts';
import { applyVolcanoWave, damageUnit as resolveDamage, discardCard, effectiveAttackInterval, healUnit, maxHealthFor, refreshLinks } from './combat-rules.ts';

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    deck: [...player.deck],
    hand: [...player.hand],
    slots: [...player.slots],
    sigils: [...player.sigils],
    discard: [...(player.discard ?? [])],
  };
}

function replacePlayer(state: GameState, side: Side, player: PlayerState): GameState {
  return { ...state, players: { ...state.players, [side]: player } };
}

function wakeOpponent(state: GameState, side: Side): GameState {
  if (state.phase !== 'playing' || side !== 'player' || state.aiStarted) return state;
  return { ...state, aiStarted: true, nextAiAtMs: state.clockMs + balance.aiInitialDelayMs };
}

function actionAllowed(state: GameState, definitionId: string, action: 'place' | 'move' | 'return' | 'cast' | 'reveal'): boolean {
  if (state.phase === 'playing') return true;
  return state.phase === 'preparation' && isPreparationActionAllowed(definitionId, action);
}

function nextRandom(value: number): [number, number] {
  let seed = value | 0;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return [seed >>> 0, (seed >>> 0) / 0x1_0000_0000];
}

function makeInstance(id: string, definitionId: string, owner: Side): CardInstance {
  const definition = getCardDefinition(definitionId);
  return {
    instanceId: id,
    definitionId,
    owner,
    health: definition.maxHealth,
    nextAttackAtMs: 0,
    revealed: false,
  };
}

function createDeck(state: GameState, owner: Side, deckIds?: string[]): { state: GameState; deck: CardInstance[] } {
  let next = state;
  const cards: CardInstance[] = [];
  const ids = deckIds ?? cardDefinitions.flatMap((definition) => Array.from({ length: balance.copiesPerDefinition }, () => definition.id));
  for (const definitionId of ids) { getCardDefinition(definitionId); cards.push(makeInstance(`${owner}-${next.nextInstanceNumber}`, definitionId, owner)); next = { ...next, nextInstanceNumber: next.nextInstanceNumber + 1 }; }
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const [rngState, random] = nextRandom(next.rngState);
    const j = Math.floor(random * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
    next = { ...next, rngState };
  }
  return { state: next, deck: cards };
}

function blankPlayer(): PlayerState {
  return {
    life: balance.startingLife,
    deck: [],
    hand: [],
    slots: Array.from({ length: boardSlotCount }, () => null),
    sigils: Array.from({ length: sigilSlotCount }, () => null),
    cycle: 1,
    cardsDrawn: 0,
    discard: [],
  };
}

export function createGame(seed = 0x7a31f22d, selectedDeck?: string[]): GameState {
  const base: GameState = {
    phase: 'playing',
    winner: null,
    clockMs: 0,
    preparationEndsAtMs: null,
    startAnnouncementEndsAtMs: null,
    nextAiAtMs: Number.POSITIVE_INFINITY,
    aiStarted: false,
    attackIntervalMs: balance.attackIntervalMs,
    aiActionIntervalMs: balance.aiActionIntervalMs,
    rngState: seed >>> 0 || 1,
    nextInstanceNumber: 1,
    eruptions: [],
    players: { player: blankPlayer(), enemy: blankPlayer() },
  };
  let state = base;
  for (const side of ['player', 'enemy'] as const) {
    const ids = selectedDeck?.length === balance.deckSize ? selectedDeck : Array.from({ length: balance.deckSize }, (_, i) => cardDefinitions[i % cardDefinitions.length]!.id);
    const created = createDeck(state, side, ids);
    state = created.state;
    const player = clonePlayer(state.players[side]);
    player.deck = created.deck.slice(balance.handLimit);
    player.hand = created.deck.slice(0, balance.handLimit);
    player.cardsDrawn = balance.handLimit;
    state = replacePlayer(state, side, player);
  }
  return state;
}

export function drawCard(state: GameState, side: Side): Transition {
  if (state.phase !== 'playing') return { state, events: [] };
  const current = state.players[side];
  if (current.hand.length >= balance.handLimit) return { state, events: [] };
  const player = clonePlayer(current);
  const events: GameEvent[] = [];
  if (player.deck.length === 0 && (player.discard?.length ?? 0) > 0) {
    player.deck = [...player.discard!].reverse(); player.discard = []; player.cycle += 1;
    events.push({ type: 'recycle', side, cycle: player.cycle });
  }
  const card = player.deck.shift();
  if (!card) return { state, events: [] };
  player.hand.push(card);
  player.cardsDrawn += 1;
  events.push({ type: 'draw', side, instanceId: card.instanceId });
  return { state: wakeOpponent(replacePlayer(state, side, player), side), events };
}

export function placeCard(state: GameState, side: Side, instanceId: string, slot: number): Transition {
  if ((state.phase !== 'playing' && state.phase !== 'preparation') || !Number.isInteger(slot) || slot < 0 || slot >= boardSlotCount) return { state, events: [] };
  const player = clonePlayer(state.players[side]);
  const handIndex = player.hand.findIndex((card) => card.instanceId === instanceId);
  const card = player.hand[handIndex];
  if (!card || player.slots[slot]) return { state, events: [] };
  if (!actionAllowed(state, card.definitionId, 'place')) return { state, events: [] };
  const kind = getCardDefinition(card.definitionId).kind;
  if (kind === 'spell') return { state, events: [] };
  player.hand.splice(handIndex, 1);
  player.slots[slot] = { ...card, nextAttackAtMs: kind === 'troop' ? state.clockMs + effectiveAttackInterval(state, card) : 0, attackTargetId: undefined, placedAtMs: state.clockMs };
  return { state: wakeOpponent(replacePlayer(state, side, player), side), events: [{ type: 'place', side, instanceId, slot }] };
}

export function moveTroop(state: GameState, side: Side, from: number, to: number): Transition {
  if ((state.phase !== 'playing' && state.phase !== 'preparation') || !Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || from >= boardSlotCount || to < 0 || to >= boardSlotCount) return { state, events: [] };
  const moving = state.players[side].slots[from];
  if (!moving || getCardDefinition(moving.definitionId).kind !== 'troop' || !actionAllowed(state, moving.definitionId, 'move') || state.players[side].slots[to] || (moving.rootedUntilMs ?? 0) > state.clockMs) return { state, events: [] };
  if (state.phase === 'playing') {
    const trapSide = side === 'player' ? 'enemy' : 'player';
    const rootsSlot = state.players[trapSide].sigils.findIndex((c) => c && getCardDefinition(c.definitionId).ability === 'roots');
    if (rootsSlot >= 0) { const result = activateSigil(state, trapSide, rootsSlot, from); if (result.events.length) return result; }
  }
  const player = clonePlayer(state.players[side]);
  const card = player.slots[from];
  if (!card) return { state, events: [] };
  player.slots[from] = null;
  player.slots[to] = card;
  const next = { ...state, players: { ...state.players, [side]: player } }; refreshLinks(next);
  return { state: wakeOpponent(next, side), events: [{ type: 'move', side, instanceId: card.instanceId, from, to }] };
}

/** Assigns an exposed enemy troop as a manual target without moving the attacking unit. */
export function assignAttackTarget(state: GameState, side: Side, attackerSlot: number, targetSlot: number): Transition {
  if (state.phase !== 'playing' || !Number.isInteger(attackerSlot) || attackerSlot < 0 || attackerSlot >= boardSlotCount) return { state, events: [] };
  const targetSide = side === 'player' ? 'enemy' : 'player';
  if (!isAttackTargetExposed(state, targetSide, targetSlot)) return { state, events: [] };
  const attacker = state.players[side].slots[attackerSlot];
  const target = state.players[targetSide].slots[targetSlot];
  if (!attacker || getCardDefinition(attacker.definitionId).kind !== 'troop' || !target) return { state, events: [] };
  if (attacker.attackTargetId === target.instanceId) return { state, events: [] };
  const player = clonePlayer(state.players[side]);
  const cooldown = Number.isFinite(attacker.nextAttackAtMs) && attacker.nextAttackAtMs > state.clockMs ? attacker.nextAttackAtMs : state.clockMs + effectiveAttackInterval(state, attacker);
  player.slots[attackerSlot] = { ...attacker, attackTargetId: target.instanceId, directAttackTarget: false, nextAttackAtMs: cooldown };
  return {
    state: replacePlayer(state, side, player),
    events: [{ type: 'target', side, attackerId: attacker.instanceId, targetId: target.instanceId, targetSlot }],
  };
}

export function assignDirectAttackTarget(state: GameState, side: Side, attackerSlot: number): Transition {
  if (state.phase !== 'playing' || !Number.isInteger(attackerSlot) || attackerSlot < 0 || attackerSlot >= boardSlotCount) return { state, events: [] };
  const attacker = state.players[side].slots[attackerSlot];
  if (!attacker || getCardDefinition(attacker.definitionId).ability !== 'plunder' || Math.floor(attackerSlot / topology.columns) === topology.frontRow[side]) return { state, events: [] };
  const player = clonePlayer(state.players[side]); const cooldown = Number.isFinite(attacker.nextAttackAtMs) && attacker.nextAttackAtMs > state.clockMs ? attacker.nextAttackAtMs : state.clockMs + effectiveAttackInterval(state, attacker); player.slots[attackerSlot] = { ...attacker, directAttackTarget: true, attackTargetId: undefined, nextAttackAtMs: cooldown };
  return { state: replacePlayer(state, side, player), events: [{ type: 'target', side, attackerId: attacker.instanceId, targetId: `life-${oppositeSide(side)}`, targetSlot: -1 }] };
}

export function assignAllyLink(state: GameState, side: Side, sourceSlot: number, targetSlot: number): Transition {
  if (state.phase !== 'playing' || !Number.isInteger(sourceSlot) || !Number.isInteger(targetSlot) || sourceSlot < 0 || sourceSlot >= boardSlotCount || targetSlot < 0 || targetSlot >= boardSlotCount) return { state, events: [] };
  const source = state.players[side].slots[sourceSlot]; const target = state.players[side].slots[targetSlot];
  if (!source || !target || getCardDefinition(source.definitionId).ability !== 'mystic-link' || sourceSlot === targetSlot || Math.floor(sourceSlot / topology.columns) === topology.frontRow[side]) return { state, events: [] };
  const player = clonePlayer(state.players[side]); player.slots[sourceSlot] = { ...source, linkedAllyId: target.instanceId };
  const next = { ...state, players: { ...state.players, [side]: player } }; refreshLinks(next);
  const linked = next.players[side].slots[sourceSlot];
  return { state: next, events: linked?.linkedAllyId ? [{ type: 'link', side, instanceId: source.instanceId, targetId: target.instanceId }] : [] };
}

export function returnTroop(state: GameState, side: Side, slot: number): Transition {
  if ((state.phase !== 'playing' && state.phase !== 'preparation') || !Number.isInteger(slot) || slot < 0 || slot >= boardSlotCount) return { state, events: [] };
  const player = clonePlayer(state.players[side]);
  const card = player.slots[slot];
  if (!card || getCardDefinition(card.definitionId).kind !== 'troop' || !actionAllowed(state, card.definitionId, 'return') || player.hand.length >= balance.handLimit) return { state, events: [] };
  player.slots[slot] = null;
  player.hand.push({ ...card, nextAttackAtMs: 0, attackTargetId: undefined });
  const opponentSide = side === 'player' ? 'enemy' : 'player';
  const opponent = clonePlayer(state.players[opponentSide]);
  opponent.slots = opponent.slots.map((unit) => unit?.attackTargetId === card.instanceId ? { ...unit, attackTargetId: undefined } : unit);
  const next = replacePlayer(replacePlayer(state, side, player), opponentSide, opponent);
  refreshLinks(next);
  return { state: wakeOpponent(next, side), events: [{ type: 'return', side, instanceId: card.instanceId, slot }] };
}

function setFinished(state: GameState, winner: Side, events: GameEvent[]): void {
  state.phase = 'finished';
  state.winner = winner;
  events.push({ type: 'game-over', winner });
}

function damageUnit(state: GameState, side: Side, slot: number, amount: number, events: GameEvent[]): void {
  resolveDamage(state, side, slot, amount, events);
}

export function castSpell(state: GameState, side: Side, instanceId: string, target: SpellTarget): Transition {
  if (state.phase !== 'playing') return { state, events: [] };
  const caster = clonePlayer(state.players[side]);
  const handIndex = caster.hand.findIndex((card) => card.instanceId === instanceId);
  const card = caster.hand[handIndex];
  if (!card) return { state, events: [] };
  const definition = getCardDefinition(card.definitionId);
  if (state.phase !== 'playing' || !actionAllowed(state, card.definitionId, 'cast') || definition.kind !== 'spell' || !definition.effect) return { state, events: [] };
  const amount = definition.spellAmount ?? (definition.effect === 'damage' ? balance.spellDamage : balance.spellHealing);
  if (target.kind === 'unit' && (!Number.isInteger(target.slot) || target.slot < 0 || target.slot >= boardSlotCount || !state.players[target.side].slots[target.slot])) return { state, events: [] };
  const intendedSide = definition.effect === 'damage' ? (side === 'player' ? 'enemy' : 'player') : side;
  if (target.side !== intendedSide) return { state, events: [] };
  if (target.kind === 'unit' && definition.effect === 'heal') {
    const unit = state.players[target.side].slots[target.slot];
    if (!unit || !unit.lastDamageReceived || unit.health >= maxHealthFor(unit)) return { state, events: [] };
  }
  if (target.kind === 'life') return { state, events: [] };
  caster.hand.splice(handIndex, 1);
  let next = replacePlayer(state, side, caster);
  const events: GameEvent[] = [{ type: 'spell', side, instanceId, targetId: state.players[target.side].slots[target.slot]?.instanceId, targetSide: target.side, targetSlot: target.slot, direct: false }];
  if (definition.effect === 'damage') {
    if (definition.ability === 'fireball' && target.kind === 'unit') {
      const chosen = next.players[target.side].slots[target.slot]!;
      const col = target.slot % topology.columns;
      const other = next.players[target.side].slots.findIndex((u, i) => i % topology.columns === col && u && u.instanceId !== chosen.instanceId);
      damageUnit(next, target.side, target.slot, definition.abilityConfig?.damage ?? 3, events);
      if (other >= 0 && next.players[target.side].slots[other]) damageUnit(next, target.side, other, definition.abilityConfig?.splashDamage ?? 1, events);
    } else if (target.kind === 'unit') damageUnit(next, target.side, target.slot, amount, events);
  } else if (target.kind === 'unit') {
    const unit = next.players[target.side].slots[target.slot];
    if (unit) healUnit(next, target.side, target.slot, Math.min(definition.abilityConfig?.healCap ?? 4, unit.lastDamageReceived ?? 0), events);
  }
  return { state: wakeOpponent(next, side), events };
}

export function revealSigil(state: GameState, side: Side, slot: number): Transition {
  return activateSigil(state, side, slot);
}

export function activateSigil(state: GameState, side: Side, slot: number, targetSlot?: number): Transition {
  if ((state.phase !== 'playing' && state.phase !== 'preparation') || !Number.isInteger(slot) || slot < 0 || slot >= sigilSlotCount) return { state, events: [] };
  if (state.phase !== 'playing') return { state, events: [] };
  const player = clonePlayer(state.players[side]);
  const card = player.sigils[slot];
  if (!card || card.revealed || !actionAllowed(state, card.definitionId, 'reveal')) return { state, events: [] };
  const definition = getCardDefinition(card.definitionId);
  if (definition.ability === 'thorns') return { state, events: [] };
  if (definition.ability === 'roots' && (targetSlot === undefined || !Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= boardSlotCount || !state.players[side === 'player' ? 'enemy' : 'player'].slots[targetSlot])) return { state, events: [] };
  player.sigils[slot] = null;
  const next = replacePlayer(state, side, player);
  const events: GameEvent[] = [{ type: 'reveal', side, instanceId: card.instanceId, slot, definitionId: card.definitionId }];
  if (definition.ability === 'roots' && targetSlot !== undefined) {
    const targetSide = side === 'player' ? 'enemy' : 'player'; const target = next.players[targetSide].slots[targetSlot]!;
    const rooted = clonePlayer(next.players[targetSide]); const untilMs = next.clockMs + (definition.abilityConfig?.rootDurationMs ?? 4000);
    rooted.slots[targetSlot] = { ...target, rootedUntilMs: untilMs, nextAttackAtMs: Math.max(next.clockMs, target.nextAttackAtMs) + (definition.abilityConfig?.delayMs ?? 2000) };
    next.players = { ...next.players, [targetSide]: rooted }; events.push({ type: 'root', side: targetSide, instanceId: target.instanceId, untilMs });
  } else if (definition.ability === 'volcano') {
    const eruption = { instanceId: card.instanceId, side, nextWaveAtMs: next.clockMs, wave: 0 };
    applyVolcanoWave(next, eruption, events);
    next.eruptions = [...(next.eruptions ?? []), { ...eruption, wave: 1, nextWaveAtMs: next.clockMs + (definition.abilityConfig?.waveIntervalMs ?? 4000) }];
    discardCard(next, card);
  } else discardCard(next, card);
  return { state: wakeOpponent(next, side), events };
}

export function placeSigil(state: GameState, side: Side, instanceId: string, slot: number): Transition {
  if ((state.phase !== 'playing' && state.phase !== 'preparation') || !Number.isInteger(slot) || slot < 0 || slot >= sigilSlotCount) return { state, events: [] };
  const player = clonePlayer(state.players[side]);
  const handIndex = player.hand.findIndex((card) => card.instanceId === instanceId);
  const card = player.hand[handIndex];
  if (!card || !actionAllowed(state, card.definitionId, 'place') || player.sigils[slot] || getCardDefinition(card.definitionId).kind !== 'hidden') return { state, events: [] };
  player.hand.splice(handIndex, 1);
  player.sigils[slot] = { ...card, revealed: false, placedAtMs: state.clockMs };
  return { state: wakeOpponent(replacePlayer(state, side, player), side), events: [{ type: 'place', side, instanceId, slot }] };
}

export function endWithWinner(state: GameState, winner: Side): Transition {
  if (state.phase !== 'playing') return { state, events: [] };
  const next = { ...state, players: { ...state.players } };
  const events: GameEvent[] = [];
  setFinished(next, winner, events);
  return { state: next, events };
}

export function beginPreparation(state: GameState, durationMs = sessionConfig.preparationDurationMs): Transition {
  if (state.phase !== 'playing' || !Number.isFinite(durationMs) || durationMs <= 0) return { state, events: [] };
  const next: GameState = {
    ...state,
    phase: 'preparation',
    preparationEndsAtMs: state.clockMs + durationMs,
    startAnnouncementEndsAtMs: null,
    aiStarted: true,
    nextAiAtMs: state.clockMs + balance.aiInitialDelayMs,
  };
  return { state: next, events: [{ type: 'preparation-start', endsAtMs: next.preparationEndsAtMs! }] };
}

/** Releases combat after the short start announcement and gives deployed units a fresh attack interval. */
export function releaseCombat(state: GameState): Transition {
  if (state.phase !== 'starting' || state.startAnnouncementEndsAtMs === null || state.clockMs < state.startAnnouncementEndsAtMs) return { state, events: [] };
  const players = { player: clonePlayer(state.players.player), enemy: clonePlayer(state.players.enemy) };
  for (const side of ['player', 'enemy'] as const) {
    players[side].slots = players[side].slots.map((card) => card && getCardDefinition(card.definitionId).kind === 'troop'
      ? { ...card, nextAttackAtMs: state.clockMs + attackIntervalFor(card.definitionId, state.attackIntervalMs) + initialAttackDelayFor(card.definitionId) }
      : card);
  }
  return {
    state: {
      ...state,
      phase: 'playing',
      preparationEndsAtMs: null,
      startAnnouncementEndsAtMs: null,
      nextAiAtMs: state.aiStarted && state.nextAiAtMs <= state.clockMs ? state.clockMs + state.aiActionIntervalMs : state.nextAiAtMs,
      players,
    },
    events: [{ type: 'combat-start' }],
  };
}
