import { getCardDefinition } from './cards.ts';
import { balance } from './config.ts';
import { castSpell, drawCard, placeCard, placeSigil } from './engine.ts';
import type { GameEvent, GameState, Side } from './types.ts';

function firstEmpty(values: Array<unknown | null>): number {
  return values.findIndex((value) => value === null);
}

export function takeAiAction(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase === 'preparation') {
    const hand = [...state.players.enemy.hand];
    for (const card of hand) {
      const definition = getCardDefinition(card.definitionId);
      if (definition.kind === 'troop') {
        const slot = firstEmpty(state.players.enemy.slots);
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
  const ai = next.players.enemy;
  if (ai.hand.length < balance.handLimit && ai.deck.length > 0) {
    const draw = drawCard(next, 'enemy');
    next = draw.state;
    events.push(...draw.events);
  }
  const hand = [...next.players.enemy.hand];
  for (const card of hand) {
    if (next.phase !== 'playing') break;
    const definition = getCardDefinition(card.definitionId);
    if (definition.kind === 'troop') {
      const slot = firstEmpty(next.players.enemy.slots);
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
      const action = castSpell(next, 'enemy', card.instanceId, target >= 0 ? { kind: 'unit', side: 'player' as Side, slot: target } : { kind: 'life', side: 'player' as Side });
      if (action.events.length) {
        next = action.state;
        events.push(...action.events);
        break;
      }
    }
    if (definition.kind === 'spell' && definition.effect === 'heal' && next.players.enemy.life < balance.startingLife) {
      const action = castSpell(next, 'enemy', card.instanceId, { kind: 'life', side: 'enemy' });
      if (action.events.length) {
        next = action.state;
        events.push(...action.events);
        break;
      }
    }
  }
  return { state: next, events };
}
