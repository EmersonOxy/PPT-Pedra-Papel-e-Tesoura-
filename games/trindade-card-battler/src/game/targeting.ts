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

export function chooseAttackTarget(state: GameState, attackerSide: Side, attackerSlot: number): AttackTarget {
  const targetSide = oppositeSide(attackerSide);
  const column = attackerSlot % topology.columns;
  const targets = state.players[targetSide].slots;
  const first = frontRow(targetSide) * topology.columns + column;
  const secondRow = frontRow(targetSide) === 0 ? 1 : 0;
  const second = secondRow * topology.columns + column;
  if (targets[first]) return { side: targetSide, slot: first, direct: false };
  if (targets[second]) return { side: targetSide, slot: second, direct: false };
  return { side: targetSide, direct: true };
}
