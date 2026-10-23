import { getCardDefinition } from './cards.ts';
import type { GameState, Side } from './types.ts';
import { topology } from './config.ts';

export interface AttackTarget {
  side: Side;
  slot?: number;
  direct: boolean;
}

export function oppositeSide(side: Side): Side {
  return side === 'player' ? 'enemy' : 'player';
}

/** Slot indices are row-major. The row nearest the center is mirrored for each side. */
export function frontRow(side: Side): number {
  return topology.frontRow[side];
}

/** A player may choose any exposed enemy troop; the front row still protects its own column. */
export function isAttackTargetExposed(state: GameState, targetSide: Side, targetSlot: number): boolean {
  if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= state.players[targetSide].slots.length) return false;
  const target = state.players[targetSide].slots[targetSlot];
  if (!target || getCardDefinition(target.definitionId).kind !== 'troop') return false;
  const row = Math.floor(targetSlot / topology.columns);
  const column = targetSlot % topology.columns;
  if (row === frontRow(targetSide)) return true;
  const protectingSlot = frontRow(targetSide) * topology.columns + column;
  return !state.players[targetSide].slots[protectingSlot];
}

export function chooseAttackTarget(state: GameState, attackerSide: Side, attackerSlot: number): AttackTarget {
  const targetSide = oppositeSide(attackerSide);
  const attacker = state.players[attackerSide].slots[attackerSlot];
  if (attacker?.attackTargetId) {
    const selectedSlot = state.players[targetSide].slots.findIndex((card) => card?.instanceId === attacker.attackTargetId);
    if (selectedSlot >= 0 && isAttackTargetExposed(state, targetSide, selectedSlot)) {
      return { side: targetSide, slot: selectedSlot, direct: false };
    }
  }
  if (Math.floor(attackerSlot / topology.columns) !== frontRow(attackerSide)) {
    if (attacker?.directAttackTarget && getCardDefinition(attacker.definitionId).ability === 'plunder') return { side: targetSide, direct: true };
    return { side: targetSide, direct: false };
  }
  const column = attackerSlot % topology.columns;
  const targets = state.players[targetSide].slots;
  const first = frontRow(targetSide) * topology.columns + column;
  const secondRow = frontRow(targetSide) === 0 ? 1 : 0;
  const second = secondRow * topology.columns + column;
  if (targets[first]) return { side: targetSide, slot: first, direct: false };
  if (targets[second]) return { side: targetSide, slot: second, direct: false };
  return { side: targetSide, direct: true };
}
