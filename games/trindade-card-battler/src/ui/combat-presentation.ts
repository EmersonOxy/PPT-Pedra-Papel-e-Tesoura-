import type { AttackAnimationProfile, Side } from '../game/types.ts';

/** Maps a card's presentation-only profile to a CSS class; combat never reads this value. */
export function attackProfileClass(profile: AttackAnimationProfile | undefined): string {
  return `attack-profile--${profile ?? 'advance'}`;
}

/** Projectile treatment follows the presentation profile; the simulation stays untouched. */
export function attackProjectileClass(side: Side, profile: AttackAnimationProfile | undefined): string {
  return `combat-projectile combat-projectile--${side}${profile === 'pulse' ? ' combat-projectile--profile-pulse' : ''}`;
}

/** Clockwise reveal angle for a dark cooldown wipe, from fully covered to clear. */
export function cooldownSweepDegrees(remainingMs: number, intervalMs: number): number {
  if (intervalMs <= 0 || remainingMs <= 0) return 360;
  const progress = 1 - Math.min(1, remainingMs / intervalMs);
  return Math.max(0, Math.min(360, progress * 360));
}

export function shouldHighlightDeck(input: {
  phase: string;
  handCount: number;
  handLimit: number;
  deckCount: number;
  hasTroopInHand: boolean;
}): boolean {
  const canDraw = input.phase === 'playing' && input.handCount < input.handLimit && input.deckCount > 0;
  return canDraw && (input.handCount === 0 || !input.hasTroopInHand);
}

/** Keeps the fan within the hand viewport while reserving room for rotated card corners. */
export function handFanSpacing(containerWidth: number, total: number, cardWidth: number): number {
  if (total <= 1) return 0;
  return Math.max(0, Math.min(61, (containerWidth - cardWidth - 12) / (total - 1)));
}
