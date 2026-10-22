import { takeAiAction } from './ai.ts';
import { releaseCombat } from './engine.ts';
import { sessionConfig } from './session-flow.ts';
import { getCardDefinition } from './cards.ts';
import { chooseAttackTarget } from './targeting.ts';
import type { GameEvent, GameState, PlayerState, Side } from './types.ts';

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
  const unitDamage = new Map<string, { side: Side; slot: number; instanceId: string; amount: number }>();
  const lifeDamage = new Map<Side, number>();

  // First choose and record every attack from the same immutable field snapshot.
  for (const { side, slot, card } of due) {
    const definition = getCardDefinition(card.definitionId);
    const target = chooseAttackTarget(snapshot, side, slot);
    const targetCard = target.slot === undefined ? undefined : snapshot.players[target.side].slots[target.slot] ?? undefined;
    events.push({ type: 'attack', side, attackerId: card.instanceId, targetSide: target.side, targetSlot: target.slot, targetId: targetCard?.instanceId, direct: target.direct });
    const currentAttacker = next.players[side].slots[slot];
    if (currentAttacker?.instanceId === card.instanceId) {
      next.players[side].slots[slot] = { ...currentAttacker, nextAttackAtMs: snapshot.clockMs + snapshot.attackIntervalMs };
    }
    if (target.direct) {
      lifeDamage.set(target.side, (lifeDamage.get(target.side) ?? 0) + definition.attack);
    } else if (target.slot !== undefined && targetCard) {
      const key = `${target.side}:${targetCard.instanceId}`;
      const existing = unitDamage.get(key);
      unitDamage.set(key, { side: target.side, slot: target.slot, instanceId: targetCard.instanceId, amount: (existing?.amount ?? 0) + definition.attack });
    }
  }

  // Apply consolidated unit damage only after target selection is complete.
  for (const hit of unitDamage.values()) {
    const target = next.players[hit.side].slots[hit.slot];
    if (!target || target.instanceId !== hit.instanceId) continue;
    const health = Math.max(0, target.health - hit.amount);
    const destroyed = health === 0;
    next.players[hit.side].slots[hit.slot] = destroyed ? null : { ...target, health };
    events.push({ type: 'damage', side: hit.side, instanceId: hit.instanceId, amount: hit.amount, destroyed });
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
    const nextEventAt = Math.min(next.nextAiAtMs, nextAttackAt);
    if (nextEventAt > endAt) break;
    next.clockMs = Math.max(next.clockMs, nextEventAt);
    const aiIsDueNow = next.nextAiAtMs === nextEventAt;
    const attacksAreDueNow = nextAttackAt === nextEventAt;

    // Intentional tie policy: resolve one scheduled AI action first, then resolve
    // every attack due at this timestamp from a single post-AI field snapshot.
    if (aiIsDueNow) {
      const ai = takeAiAction(next);
      next = ai.state;
      events.push(...ai.events);
      next.nextAiAtMs = nextEventAt + next.aiActionIntervalMs;
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
