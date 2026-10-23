import { getCardDefinition } from './cards.ts';
import { attackIntervalFor, topology } from './config.ts';
import type { CardInstance, GameEvent, GameState, Side } from './types.ts';

export function effectiveAttack(card: CardInstance): number {
  const d = getCardDefinition(card.definitionId);
  return d.attack + (d.ability === 'fury' && card.health <= (d.abilityConfig?.furyThreshold ?? 3) ? d.abilityConfig?.furyBonus ?? 1 : 0);
}
export function maxHealthFor(card: CardInstance): number { return card.derived ? getCardDefinition('veil-oracle').abilityConfig?.summonHealth ?? 2 : getCardDefinition(card.definitionId).maxHealth; }
export function effectiveAttackInterval(state: GameState, sideOrCard: Side | CardInstance, maybeCard?: CardInstance): number {
  const card = typeof sideOrCard === 'string' ? maybeCard! : sideOrCard;
  const reduction = state.players[card.owner].slots.reduce((sum, source, slot) => sum + (source && source.linkedAllyId === card.instanceId && getCardDefinition(source.definitionId).ability === 'mystic-link' && Math.floor(slot / topology.columns) !== topology.frontRow[card.owner] ? getCardDefinition(source.definitionId).abilityConfig?.intervalReductionMs ?? 1000 : 0), 0);
  return Math.max(1000, attackIntervalFor(card.definitionId, state.attackIntervalMs) - reduction);
}
export function refreshLinks(state: GameState, events: GameEvent[] = []): void {
  for (const side of ['player', 'enemy'] as const) {
    state.players[side] = { ...state.players[side], slots: [...state.players[side].slots] };
    for (let slot = 0; slot < state.players[side].slots.length; slot++) {
      const source = state.players[side].slots[slot];
      if (source?.linkedAllyId && (Math.floor(slot / topology.columns) === topology.frontRow[side] || !state.players[side].slots.some((u) => u?.instanceId === source.linkedAllyId))) {
        state.players[side].slots[slot] = { ...source, linkedAllyId: undefined };
        events.push({ type: 'link', side, instanceId: source.instanceId });
      }
    }
    state.players[side].slots = state.players[side].slots.map((card) => {
      if (!card) return card;
      const reduction = attackIntervalFor(card.definitionId, state.attackIntervalMs) - effectiveAttackInterval(state, card);
      const old = card.intervalReductionMs ?? 0;
      return reduction === old ? card : { ...card, intervalReductionMs: reduction, nextAttackAtMs: Math.max(state.clockMs, card.nextAttackAtMs + old - reduction) };
    });
  }
}
export function discardCard(state: GameState, card: CardInstance): void {
  if (card.derived) return;
  const p = state.players[card.owner];
  state.players[card.owner] = { ...p, discard: [...(p.discard ?? []), card] };
}
/** All effects resolve through this damage/death path; a return is not a death. */
export function damageUnit(state: GameState, side: Side, slot: number, amount: number, events: GameEvent[]): { eliminated: boolean; excess: number } {
  const card = state.players[side].slots[slot];
  if (!card || amount <= 0 || !Number.isFinite(amount)) return { eliminated: false, excess: 0 };
  const d = getCardDefinition(card.definitionId);
  const health = Math.max(0, card.health - amount);
  const resurrects = health === 0 && d.ability === 'resurrection' && !card.resurrectionUsed && !card.derived;
  const destroyed = health === 0 && !resurrects;
  const p = { ...state.players[side], slots: [...state.players[side].slots] };
  p.slots[slot] = destroyed ? null : { ...card, health: resurrects ? d.abilityConfig?.resurrectionHealth ?? 2 : health, lastDamageReceived: amount, resurrectionUsed: card.resurrectionUsed || resurrects, ...(resurrects ? {nextAttackAtMs:state.clockMs + effectiveAttackInterval(state,card)} : {}) };
  state.players = { ...state.players, [side]: p };
  events.push({ type: 'damage', side, instanceId: card.instanceId, amount, destroyed });
  if (resurrects) events.push({ type: 'resurrect', side, instanceId: card.instanceId, slot });
  if (destroyed) {
    discardCard(state, card);
    refreshLinks(state, events);
    const witchSlot = state.players[side].slots.findIndex((unit, index) => unit && index % topology.columns === slot % topology.columns && getCardDefinition(unit.definitionId).ability === 'necromancy' && !unit.summonUsed);
    if (witchSlot >= 0) {
      const witch = state.players[side].slots[witchSlot]!;
      const instanceId = `${side}-${state.nextInstanceNumber++}`;
      const summoned: CardInstance = { instanceId, definitionId: 'solemn-guardian', owner: side, health: getCardDefinition(witch.definitionId).abilityConfig?.summonHealth ?? 2, nextAttackAtMs: state.clockMs + attackIntervalFor('solemn-guardian'), revealed: true, derived: true, resurrectionUsed: true };
      state.players[side].slots[witchSlot] = { ...witch, summonUsed: true };
      state.players[side].slots[slot] = summoned;
      events.push({ type: 'summon', side, instanceId, slot, sourceId: witch.instanceId });
    }
  }
  return { eliminated: destroyed, excess: destroyed ? Math.max(0, amount - card.health) : 0 };
}
export function healUnit(state: GameState, side: Side, slot: number, amount: number, events: GameEvent[]): void {
  const unit = state.players[side].slots[slot]; if (!unit) return;
  const healing = Math.max(0, Math.min(amount, maxHealthFor(unit) - unit.health));
  state.players[side] = { ...state.players[side], slots: [...state.players[side].slots] };
  state.players[side].slots[slot] = { ...unit, health: unit.health + healing };
  if (healing) events.push({ type: 'heal', side, instanceId: unit.instanceId, amount: healing });
}
export function applyVolcanoWave(state: GameState, eruption: { instanceId: string; side: Side; wave: number }, events: GameEvent[]): void {
  events.push({ type: 'volcano-wave', side: eruption.side, instanceId: eruption.instanceId, wave: eruption.wave + 1 });
  const targets = (['enemy', 'player'] as const).flatMap((side) => state.players[side].slots.map((card, slot) => card ? { side, slot, instanceId: card.instanceId } : null).filter((v): v is { side: Side; slot: number; instanceId: string } => !!v));
  for (const target of targets) {
    const unit = state.players[target.side].slots[target.slot]; if (!unit || unit.instanceId !== target.instanceId) continue;
    const amount = target.side === eruption.side ? 1 : 2;
    damageUnit(state, target.side, target.slot, amount, events);
  }
  refreshLinks(state, events);
}
