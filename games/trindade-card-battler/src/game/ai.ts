import { getCardDefinition } from './cards.ts';
import { balance } from './config.ts';
import { activateSigil, assignAllyLink, assignAttackTarget, assignDirectAttackTarget, castSpell, drawCard, moveTroop, placeCard, placeSigil } from './engine.ts';
import { topology } from './config.ts';
import { isAttackTargetExposed } from './targeting.ts';
import type { GameEvent, GameState, Side } from './types.ts';

function firstEmpty(values: Array<unknown | null>): number {
  return values.findIndex((value) => value === null);
}
function firstFrontEmpty(state: GameState): number {
  const side: Side = 'enemy';
  for (let column = 0; column < topology.columns; column += 1) {
    const slot = topology.frontRow[side] * topology.columns + column;
    if (!state.players[side].slots[slot]) return slot;
  }
  return firstEmpty(state.players[side].slots);
}
function preferredSlot(state: GameState, definitionId: string): number {
  const definition = getCardDefinition(definitionId);
  const rear = topology.frontRow.enemy === 0 ? 1 : 0;
  if (definition.ability === 'plunder' || definition.ability === 'mystic-link' || definition.ability === 'necromancy') {
    for (let column = 0; column < topology.columns; column += 1) {
      const slot = rear * topology.columns + column;
      if (!state.players.enemy.slots[slot]) return slot;
    }
  }
  return firstFrontEmpty(state);
}

export function takeAiAction(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase === 'preparation') {
    const hand = [...state.players.enemy.hand];
    for (const card of hand) {
      const definition = getCardDefinition(card.definitionId);
      if (definition.kind === 'troop') {
        const slot = preferredSlot(state, card.definitionId);
        if (slot >= 0) {
          const action = placeCard(state, 'enemy', card.instanceId, slot);
          if (action.events.length) return action;
        }
      }
      if (definition.kind === 'hidden') {
        const slot = firstEmpty(state.players.enemy.sigils);
        if (slot >= 0) {
          const action = placeSigil(state, 'enemy', card.instanceId, slot);
          if (action.events.length) return action;
        }
      }
    }
    return { state, events: [] };
  }
  if (state.phase !== 'playing') return { state, events: [] };
  let next = state;
  const events: GameEvent[] = [];
  // The simulated opponent issues the same explicit rear-row orders a player can.
  for (let slot = 0; slot < next.players.enemy.slots.length; slot += 1) {
    const unit = next.players.enemy.slots[slot]; if (!unit) continue;
    const definition = getCardDefinition(unit.definitionId);
    if (Math.floor(slot / topology.columns) === topology.frontRow.enemy) continue;
    if (definition.ability === 'mystic-link' && !unit.linkedAllyId) {
      const ally = next.players.enemy.slots.findIndex((candidate, i) => candidate && i !== slot);
      if (ally >= 0) { const linked = assignAllyLink(next, 'enemy', slot, ally); if (linked.events.length) { next = linked.state; events.push(...linked.events); return { state: next, events }; } }
    }
    if (!unit.attackTargetId && !unit.directAttackTarget) {
      if (definition.ability === 'plunder') { const order = assignDirectAttackTarget(next, 'enemy', slot); if (order.events.length) { next = order.state; events.push(...order.events); return { state: next, events }; } }
      const targetSide: Side = 'player';
      const targetSlot = next.players[targetSide].slots.findIndex((candidate, i) => candidate && isAttackTargetExposed(next, targetSide, i));
      if (targetSlot >= 0) { const order = assignAttackTarget(next, 'enemy', slot, targetSlot); if (order.events.length) { next = order.state; events.push(...order.events); return { state: next, events }; } }
    }
  }
  // The opponent actively rotates reserves into open frontline lanes. Support
  // units that need a rear position keep their role, while the aggressive deck
  // advances every other reserve as soon as its lane opens.
  const profile = next.aiProfileId;
  const rearRow = topology.frontRow.enemy === 0 ? 1 : 0;
  for (let column = 0; column < topology.columns; column += 1) {
    const front = topology.frontRow.enemy * topology.columns + column;
    const rear = rearRow * topology.columns + column;
    const reserve = next.players.enemy.slots[rear];
    if (!reserve || next.players.enemy.slots[front]) continue;
    const ability = getCardDefinition(reserve.definitionId).ability;
    if (ability === 'plunder' || ability === 'mystic-link' || (profile === 'bastilha' && ability !== 'resurrection' && ability !== 'necromancy')) continue;
    if (profile === 'bastilha' && !next.players.player.slots.some(Boolean)) continue;
    const moved = moveTroop(next, 'enemy', rear, front);
    if (moved.events.length) return { state: moved.state, events: [...events, ...moved.events] };
  }
  for (let slot = 0; slot < next.players.enemy.sigils.length; slot += 1) {
    const hidden = next.players.enemy.sigils[slot]; if (!hidden) continue;
    const ability = getCardDefinition(hidden.definitionId).ability;
    if (ability === 'volcano') { const action = activateSigil(next, 'enemy', slot); if (action.events.length) return { state: action.state, events: [...events, ...action.events] }; }
    if (ability === 'roots') {
      const target = next.players.player.slots.findIndex((candidate) => candidate !== null);
      if (target >= 0) { const action = activateSigil(next, 'enemy', slot, target); if (action.events.length) return { state: action.state, events: [...events, ...action.events] }; }
    }
  }
  const ai = next.players.enemy;
  if (ai.hand.length < balance.handLimit && (ai.deck.length > 0 || (ai.discard?.length ?? 0) > 0)) {
    const draw = drawCard(next, 'enemy');
    next = draw.state;
    events.push(...draw.events);
  }
  const hand = [...next.players.enemy.hand];
  for (const card of hand) {
    if (next.phase !== 'playing') break;
    const definition = getCardDefinition(card.definitionId);
    if (definition.kind === 'troop') {
      const slot = preferredSlot(next, card.definitionId);
      if (slot >= 0) {
        const action = placeCard(next, 'enemy', card.instanceId, slot);
        if (action.events.length) {
          next = action.state;
          events.push(...action.events);
          break;
        }
      }
    }
    if (definition.kind === 'hidden') {
      const slot = firstEmpty(next.players.enemy.sigils);
      if (slot >= 0) {
        const action = placeSigil(next, 'enemy', card.instanceId, slot);
        if (action.events.length) {
          next = action.state;
          events.push(...action.events);
          break;
        }
      }
    }
    if (definition.kind === 'spell' && definition.effect === 'damage') {
      const target = next.players.player.slots.findIndex((unit) => unit !== null);
      const action = target >= 0 ? castSpell(next, 'enemy', card.instanceId, { kind: 'unit', side: 'player' as Side, slot: target }) : { state: next, events: [] };
      if (action.events.length) {
        next = action.state;
        events.push(...action.events);
        break;
      }
    }
    if (definition.kind === 'spell' && definition.effect === 'heal') {
      const target = next.players.enemy.slots.findIndex(unit => unit?.lastDamageReceived && unit.health < getCardDefinition(unit.definitionId).maxHealth);
      const action = target >= 0 ? castSpell(next, 'enemy', card.instanceId, { kind: 'unit', side: 'enemy', slot: target }) : { state: next, events: [] };
      if (action.events.length) {
        next = action.state;
        events.push(...action.events);
        break;
      }
    }
  }
  return { state: next, events };
}
