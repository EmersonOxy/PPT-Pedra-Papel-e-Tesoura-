import { takeAiAction } from './ai.ts';
import { releaseCombat } from './engine.ts';
import { sessionConfig } from './session-flow.ts';
import { getCardDefinition } from './cards.ts';
import { topology } from './config.ts';
import { chooseAttackTarget } from './targeting.ts';
import type { CardInstance, GameEvent, GameState, PlayerState, Side } from './types.ts';
import { applyVolcanoWave, damageUnit, discardCard, effectiveAttack, effectiveAttackInterval, healUnit, refreshLinks } from './combat-rules.ts';

interface DueAttack { side: Side; slot: number; at: number; }

function dueAttacks(state: GameState): DueAttack[] {
  const due: DueAttack[] = [];
  for (const side of ['player', 'enemy'] as const) {
    state.players[side].slots.forEach((card, slot) => {
      if (card && getCardDefinition(card.definitionId).kind === 'troop') {
        due.push({ side, slot, at: card.nextAttackAtMs });
      }
    });
  }
  return due.sort((a, b) => a.at - b.at || (a.side === b.side ? a.slot - b.slot : a.side === 'player' ? -1 : 1));
}

function clonePlayer(player: PlayerState): PlayerState {
  return { ...player, deck: [...player.deck], hand: [...player.hand], slots: [...player.slots], sigils: [...player.sigils] };
}

/** Private scheduler operation: attack resolution is only reachable through advanceTime. */
function resolveDueAttacks(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== 'playing' || !Number.isFinite(state.clockMs)) return { state, events: [] };
  const snapshot = state;
  const due = dueAttacks(snapshot)
    .filter((attack) => attack.at <= snapshot.clockMs)
    .map(({ side, slot }) => ({ side, slot, card: snapshot.players[side].slots[slot]! }));
  if (!due.length) return { state, events: [] };

  const next: GameState = { ...state, players: { player: clonePlayer(state.players.player), enemy: clonePlayer(state.players.enemy) } };
  const events: GameEvent[] = [];
  const unitDamage = new Map<string, { side: Side; slot: number; instanceId: string; amount: number; attacker: CardInstance }>();
  const lifeDamage = new Map<Side, number>();

  // First choose and record every attack from the same immutable field snapshot.
  for (const { side, slot, card } of due) {
    const definition = getCardDefinition(card.definitionId);
    const target = chooseAttackTarget(snapshot, side, slot);
    if (!target.direct && target.slot === undefined) {
      const current = next.players[side].slots[slot];
      if (current?.instanceId === card.instanceId && current.nextAttackAtMs <= snapshot.clockMs) { next.players[side] = { ...next.players[side], slots: [...next.players[side].slots] }; next.players[side].slots[slot] = { ...current, nextAttackAtMs: Number.POSITIVE_INFINITY }; }
      continue;
    }
    const targetCard = target.slot === undefined ? undefined : snapshot.players[target.side].slots[target.slot] ?? undefined;
    // Thorns are resolved immediately before one declared unit attack; oldest trap wins.
    if (!target.direct && target.slot !== undefined) {
      const trapSide = target.side;
      const trapSlot = next.players[trapSide].sigils.map((trap, index) => ({ trap, index })).filter(({ trap }) => trap && getCardDefinition(trap.definitionId).ability === 'thorns').sort((a,b) => (a.trap!.placedAtMs ?? 0) - (b.trap!.placedAtMs ?? 0) || a.index-b.index)[0]?.index;
      if (trapSlot !== undefined) {
        const trapPlayer = { ...next.players[trapSide], sigils: [...next.players[trapSide].sigils] };
        const trap = trapPlayer.sigils[trapSlot]!; trapPlayer.sigils[trapSlot] = null; next.players = { ...next.players, [trapSide]: trapPlayer };
        events.push({ type: 'reveal', side: trapSide, instanceId: trap.instanceId, slot: trapSlot, definitionId: trap.definitionId });
        discardCard(next, trap);
        if (!trap) continue;
        const reacted = damageUnit(next, side, slot, getCardDefinition(trap.definitionId).abilityConfig?.damage ?? 2, events);
        if (reacted.eliminated || !next.players[side].slots[slot] || next.players[side].slots[slot]?.instanceId !== card.instanceId) continue;
        const attackerNow = next.players[side].slots[slot]!;
        const delay = getCardDefinition(trap.definitionId).abilityConfig?.delayMs ?? 2000;
        next.players[side] = { ...next.players[side], slots: [...next.players[side].slots] };
        next.players[side].slots[slot] = { ...attackerNow, nextAttackAtMs: attackerNow.nextAttackAtMs + delay };
      }
    }
    events.push({ type: 'attack', side, attackerId: card.instanceId, targetSide: target.side, targetSlot: target.slot, targetId: targetCard?.instanceId, direct: target.direct });
    const currentAttacker = next.players[side].slots[slot];
    if (currentAttacker?.instanceId === card.instanceId) {
      next.players[side].slots[slot] = { ...currentAttacker, nextAttackAtMs: snapshot.clockMs + effectiveAttackInterval(next, currentAttacker) + (currentAttacker.nextAttackAtMs > snapshot.clockMs ? currentAttacker.nextAttackAtMs - snapshot.clockMs : 0) };
    }
    if (target.direct) {
      lifeDamage.set(target.side, (lifeDamage.get(target.side) ?? 0) + effectiveAttack(card));
      if (definition.ability === 'plunder') {
        healUnit(next, side, slot, definition.abilityConfig?.healOnDirect ?? 1, events);
      }
    } else if (target.slot !== undefined && targetCard) {
      const key = `${target.side}:${targetCard.instanceId}`;
      const existing = unitDamage.get(key);
      unitDamage.set(key, { side: target.side, slot: target.slot, instanceId: targetCard.instanceId, attacker: card, amount: (existing?.amount ?? 0) + effectiveAttack(card) });
    }
  }

  // Apply consolidated unit damage only after target selection is complete.
  for (const hit of unitDamage.values()) {
    const target = next.players[hit.side].slots[hit.slot];
    if (!target || target.instanceId !== hit.instanceId) continue;
    const result = damageUnit(next, hit.side, hit.slot, hit.amount, events);
    if (result.eliminated && Math.floor(hit.slot / topology.columns) === topology.frontRow[hit.side] && getCardDefinition(hit.attacker.definitionId).ability === 'crush' && result.excess > 0) {
      const column = hit.slot % topology.columns; const rearRow = topology.frontRow[hit.side] === 0 ? 1 : 0; const rearSlot = rearRow * topology.columns + column;
      if (next.players[hit.side].slots[rearSlot]) damageUnit(next, hit.side, rearSlot, result.excess, events);
    }
  }
  for (const side of ['player', 'enemy'] as const) {
    const amount = lifeDamage.get(side) ?? 0;
    if (!amount) continue;
    const player = next.players[side];
    player.life = Math.max(0, player.life - amount);
    events.push({ type: 'life-damage', side, amount, value: player.life });
  }

  const playerDefeated = next.players.player.life === 0;
  const enemyDefeated = next.players.enemy.life === 0;
  if (playerDefeated && enemyDefeated) {
    next.phase = 'finished';
    next.winner = null;
    events.push({ type: 'game-draw' });
  } else if (playerDefeated || enemyDefeated) {
    const winner = playerDefeated ? 'enemy' : 'player';
    next.phase = 'finished';
    next.winner = winner;
    events.push({ type: 'game-over', winner });
  }
  refreshLinks(next, events);
  return { state: next, events };
}

function resolveVolcanoWaves(state: GameState): { state: GameState; events: GameEvent[] } {
  const due = (state.eruptions ?? []).filter((eruption) => eruption.nextWaveAtMs <= state.clockMs);
  if (!due.length) return { state, events: [] };
  const next = { ...state, players: { player: clonePlayer(state.players.player), enemy: clonePlayer(state.players.enemy) }, eruptions: [...(state.eruptions ?? [])] };
  const events: GameEvent[] = [];
  for (const eruption of due) {
    const definition = getCardDefinition('eclipse-seal'); const waveCount = definition.abilityConfig?.waveCount ?? 3;
    applyVolcanoWave(next, eruption, events);
    if (eruption.wave + 1 >= waveCount) next.eruptions = next.eruptions.filter((item) => item.instanceId !== eruption.instanceId);
    else next.eruptions = next.eruptions.map((item) => item.instanceId === eruption.instanceId ? { ...item, wave: item.wave + 1, nextWaveAtMs: item.nextWaveAtMs + (definition.abilityConfig?.waveIntervalMs ?? 4000) } : item);
  }
  return { state: next, events };
}

export function advanceTime(state: GameState, deltaMs: number): { state: GameState; events: GameEvent[] } {
  if (state.phase === 'finished' || !Number.isFinite(deltaMs) || deltaMs <= 0) return { state, events: [] };
  const endAt = state.clockMs + Math.min(deltaMs, 60_000);
  let next = { ...state };
  const events: GameEvent[] = [];
  let safety = 0;
  while (next.phase !== 'finished' && safety < 512) {
    safety += 1;
    if (next.phase === 'preparation') {
      const preparationEndsAt = next.preparationEndsAtMs ?? next.clockMs;
      const aiDueAt = next.aiStarted && next.nextAiAtMs <= preparationEndsAt ? next.nextAiAtMs : Number.POSITIVE_INFINITY;
      const nextPreparationEventAt = Math.min(preparationEndsAt, aiDueAt);
      if (nextPreparationEventAt > endAt) break;
      next.clockMs = Math.max(next.clockMs, nextPreparationEventAt);
      if (aiDueAt === nextPreparationEventAt) {
        // At an exact tie, one scheduled AI preparation action happens before preparation closes.
        const ai = takeAiAction(next);
        next = ai.state;
        events.push(...ai.events);
        next.nextAiAtMs = nextPreparationEventAt + next.aiActionIntervalMs;
      } else {
        next.phase = 'starting';
        next.preparationEndsAtMs = null;
        next.startAnnouncementEndsAtMs = nextPreparationEventAt + sessionConfig.battleAnnouncementMs;
        events.push({ type: 'preparation-end' });
      }
      continue;
    }
    if (next.phase === 'starting') {
      const combatStartsAt = next.startAnnouncementEndsAtMs ?? Number.POSITIVE_INFINITY;
      if (combatStartsAt > endAt) break;
      next.clockMs = Math.max(next.clockMs, combatStartsAt);
      const combat = releaseCombat(next);
      next = combat.state;
      events.push(...combat.events);
      continue;
    }
    const attacks = dueAttacks(next);
    const nextAttackAt = attacks[0]?.at ?? Number.POSITIVE_INFINITY;
    const volcanoAt = Math.min(...(next.eruptions ?? []).map((eruption) => eruption.nextWaveAtMs), Number.POSITIVE_INFINITY);
    const nextEventAt = Math.min(next.nextAiAtMs, nextAttackAt, volcanoAt);
    if (nextEventAt > endAt) break;
    next.clockMs = Math.max(next.clockMs, nextEventAt);
    const aiIsDueNow = next.nextAiAtMs === nextEventAt;
    const attacksAreDueNow = nextAttackAt === nextEventAt;
    const volcanoIsDueNow = volcanoAt === nextEventAt;

    // Intentional tie policy: resolve one scheduled AI action first, then resolve
    // every attack due at this timestamp from a single post-AI field snapshot.
    if (aiIsDueNow) {
      const ai = takeAiAction(next);
      next = ai.state;
      events.push(...ai.events);
      next.nextAiAtMs = nextEventAt + next.aiActionIntervalMs;
    }
    if (volcanoIsDueNow && next.phase === 'playing') {
      const result = resolveVolcanoWaves(next); next = result.state; events.push(...result.events);
    }
    if (attacksAreDueNow && next.phase === 'playing') {
      const result = resolveDueAttacks(next);
      next = result.state;
      events.push(...result.events);
    }
  }
  next.clockMs = Math.max(next.clockMs, endAt);
  return { state: next, events };
}
