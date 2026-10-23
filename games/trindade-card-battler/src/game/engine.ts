import { balance, boardSlotCount, sigilSlotCount } from './config.ts';
import { isAttackTargetExposed } from './targeting.ts';
import { isPreparationActionAllowed, sessionConfig } from './session-flow.ts';
import { cardDefinitions, getCardDefinition } from './cards.ts';
import type { CardInstance, GameEvent, GameState, PlayerState, Side, SpellTarget, Transition } from './types.ts';

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    deck: [...player.deck],
    hand: [...player.hand],
    slots: [...player.slots],
    sigils: [...player.sigils],
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

function createDeck(state: GameState, owner: Side): { state: GameState; deck: CardInstance[] } {
  let next = state;
  const cards: CardInstance[] = [];
  for (const definition of cardDefinitions) {
    for (let copy = 0; copy < balance.copiesPerDefinition; copy += 1) {
      cards.push(makeInstance(`${owner}-${next.nextInstanceNumber}`, definition.id, owner));
      next = { ...next, nextInstanceNumber: next.nextInstanceNumber + 1 };
    }
  }
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
  };
}

export function createGame(seed = 0x7a31f22d): GameState {
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
    players: { player: blankPlayer(), enemy: blankPlayer() },
  };
  let state = base;
  for (const side of ['player', 'enemy'] as const) {
    const created = createDeck(state, side);
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
  if (current.hand.length >= balance.handLimit || current.deck.length === 0) return { state, events: [] };
  const player = clonePlayer(current);
  const card = player.deck.shift();
  if (!card) return { state, events: [] };
  player.hand.push(card);
  player.cardsDrawn += 1;
  return { state: wakeOpponent(replacePlayer(state, side, player), side), events: [{ type: 'draw', side, instanceId: card.instanceId }] };
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
  player.slots[slot] = { ...card, nextAttackAtMs: kind === 'troop' ? state.clockMs + state.attackIntervalMs : 0, attackTargetId: undefined };
  return { state: wakeOpponent(replacePlayer(state, side, player), side), events: [{ type: 'place', side, instanceId, slot }] };
}

export function moveTroop(state: GameState, side: Side, from: number, to: number): Transition {
  if ((state.phase !== 'playing' && state.phase !== 'preparation') || !Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || from >= boardSlotCount || to < 0 || to >= boardSlotCount) return { state, events: [] };
  const player = clonePlayer(state.players[side]);
  const card = player.slots[from];
  if (!card || getCardDefinition(card.definitionId).kind !== 'troop' || !actionAllowed(state, card.definitionId, 'move') || player.slots[to]) return { state, events: [] };
  player.slots[from] = null;
  player.slots[to] = card;
  return { state: wakeOpponent(replacePlayer(state, side, player), side), events: [{ type: 'move', side, instanceId: card.instanceId, from, to }] };
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
  player.slots[attackerSlot] = { ...attacker, attackTargetId: target.instanceId };
  return {
    state: replacePlayer(state, side, player),
    events: [{ type: 'target', side, attackerId: attacker.instanceId, targetId: target.instanceId, targetSlot }],
  };
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
  return { state: wakeOpponent(next, side), events: [{ type: 'return', side, instanceId: card.instanceId, slot }] };
}

function setFinished(state: GameState, winner: Side, events: GameEvent[]): void {
  state.phase = 'finished';
  state.winner = winner;
  events.push({ type: 'game-over', winner });
}

function damageUnit(state: GameState, side: Side, slot: number, amount: number, events: GameEvent[]): void {
  const player = clonePlayer(state.players[side]);
  const card = player.slots[slot];
  if (!card) return;
  const health = Math.max(0, card.health - amount);
  const destroyed = health === 0;
  if (destroyed) player.slots[slot] = null;
  else player.slots[slot] = { ...card, health };
  events.push({ type: 'damage', side, instanceId: card.instanceId, amount, destroyed });
  state.players = { ...state.players, [side]: player };
}

function damageLife(state: GameState, side: Side, amount: number, events: GameEvent[]): void {
  const player = clonePlayer(state.players[side]);
  player.life = Math.max(0, player.life - amount);
  state.players = { ...state.players, [side]: player };
  events.push({ type: 'life-damage', side, amount, value: player.life });
  if (player.life === 0) setFinished(state, side === 'player' ? 'enemy' : 'player', events);
}

export function castSpell(state: GameState, side: Side, instanceId: string, target: SpellTarget): Transition {
  if (state.phase !== 'playing') return { state, events: [] };
  const caster = clonePlayer(state.players[side]);
  const handIndex = caster.hand.findIndex((card) => card.instanceId === instanceId);
  const card = caster.hand[handIndex];
  if (!card) return { state, events: [] };
  const definition = getCardDefinition(card.definitionId);
  if (state.phase !== 'playing' || !actionAllowed(state, card.definitionId, 'cast') || definition.kind !== 'spell' || !definition.effect) return { state, events: [] };
  if (target.kind === 'unit' && (!Number.isInteger(target.slot) || target.slot < 0 || target.slot >= boardSlotCount || !state.players[target.side].slots[target.slot])) return { state, events: [] };
  const intendedSide = definition.effect === 'damage' ? (side === 'player' ? 'enemy' : 'player') : side;
  if (target.side !== intendedSide) return { state, events: [] };
  if (target.kind === 'unit' && definition.effect === 'heal') {
    const unit = state.players[target.side].slots[target.slot];
    if (!unit || unit.health >= getCardDefinition(unit.definitionId).maxHealth) return { state, events: [] };
  }
  if (target.kind === 'life' && definition.effect === 'heal' && state.players[target.side].life >= balance.startingLife) return { state, events: [] };
  caster.hand.splice(handIndex, 1);
  let next = replacePlayer(state, side, caster);
  const events: GameEvent[] = [{ type: 'spell', side, instanceId, targetId: target.kind === 'unit' ? state.players[target.side].slots[target.slot]?.instanceId : undefined, targetSide: target.side, targetSlot: target.kind === 'unit' ? target.slot : undefined, direct: target.kind === 'life' }];
  if (definition.effect === 'damage') {
    if (target.kind === 'life') damageLife(next, target.side, balance.spellDamage, events);
    else damageUnit(next, target.side, target.slot, balance.spellDamage, events);
  } else if (target.kind === 'life') {
    const healed = clonePlayer(next.players[target.side]);
    healed.life = Math.min(balance.startingLife, healed.life + balance.spellHealing);
    next.players = { ...next.players, [target.side]: healed };
    events.push({ type: 'life-heal', side: target.side, amount: healed.life - state.players[target.side].life, value: healed.life });
  } else {
    const healed = clonePlayer(next.players[target.side]);
    const unit = healed.slots[target.slot];
    if (unit) {
      const amount = Math.min(balance.spellHealing, getCardDefinition(unit.definitionId).maxHealth - unit.health);
      healed.slots[target.slot] = { ...unit, health: unit.health + amount };
      next.players = { ...next.players, [target.side]: healed };
      events.push({ type: 'heal', side: target.side, instanceId: unit.instanceId, amount });
    }
  }
  return { state: wakeOpponent(next, side), events };
}

export function revealSigil(state: GameState, side: Side, slot: number): Transition {
  if ((state.phase !== 'playing' && state.phase !== 'preparation') || !Number.isInteger(slot) || slot < 0 || slot >= sigilSlotCount) return { state, events: [] };
  const player = clonePlayer(state.players[side]);
  const card = player.sigils[slot];
  if (!card || card.revealed || !actionAllowed(state, card.definitionId, 'reveal')) return { state, events: [] };
  player.sigils[slot] = { ...card, revealed: true };
  return { state: wakeOpponent(replacePlayer(state, side, player), side), events: [{ type: 'reveal', side, instanceId: card.instanceId, slot }] };
}

export function placeSigil(state: GameState, side: Side, instanceId: string, slot: number): Transition {
  if ((state.phase !== 'playing' && state.phase !== 'preparation') || !Number.isInteger(slot) || slot < 0 || slot >= sigilSlotCount) return { state, events: [] };
  const player = clonePlayer(state.players[side]);
  const handIndex = player.hand.findIndex((card) => card.instanceId === instanceId);
  const card = player.hand[handIndex];
  if (!card || !actionAllowed(state, card.definitionId, 'place') || player.sigils[slot] || getCardDefinition(card.definitionId).kind !== 'hidden') return { state, events: [] };
  player.hand.splice(handIndex, 1);
  player.sigils[slot] = { ...card, revealed: false };
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
      ? { ...card, nextAttackAtMs: state.clockMs + state.attackIntervalMs }
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
