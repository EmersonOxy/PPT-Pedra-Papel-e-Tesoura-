export type Side = 'player' | 'enemy';
export type CardKind = 'troop' | 'hidden' | 'spell';
export type Foundation = 'guarda' | 'tecnica' | 'impacto';
export type SpellEffect = 'damage' | 'heal';
export type AttackAnimationProfile = 'advance' | 'impact' | 'spin' | 'pulse';
export type GamePhase = 'preparation' | 'starting' | 'playing' | 'finished';

export type CardAbility = 'resurrection' | 'necromancy' | 'crush' | 'mystic-link' | 'plunder' | 'fury' | 'equivalent-heal' | 'fireball' | 'thorns' | 'roots' | 'volcano';
export interface AbilityConfig { resurrectionHealth?: number; summonLimit?: number; summonHealth?: number; intervalReductionMs?: number; healOnDirect?: number; furyThreshold?: number; furyBonus?: number; healCap?: number; splashDamage?: number; damage?: number; delayMs?: number; rootDurationMs?: number; waveCount?: number; waveIntervalMs?: number; enemyDamage?: number; allyDamage?: number; }
export interface CardDefinition {
  ability?: CardAbility;
  abilityConfig?: AbilityConfig;
  attackIntervalMs?: number;
  id: string;
  name: string;
  kind: CardKind;
  foundation: Foundation;
  cost: number;
  attack: number;
  maxHealth: number;
  /** Current per-card spell effect amount, used by the existing damage/heal effect. */
  spellAmount?: number;
  description: string;
  effect?: SpellEffect;
  /** Presentation-only profile. It never participates in combat resolution. */
  attackAnimationProfile?: AttackAnimationProfile;
}

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  owner: Side;
  health: number;
  nextAttackAtMs: number;
  revealed: boolean;
  resurrectionUsed?: boolean;
  summonUsed?: boolean;
  derived?: boolean;
  lastDamageReceived?: number;
  linkedAllyId?: string;
  rootedUntilMs?: number;
  placedAtMs?: number;
  directAttackTarget?: boolean;
  intervalReductionMs?: number;
  /** Optional player-selected target. Invalid or unavailable targets fall back to the normal lane rule. */
  attackTargetId?: string;
}

export interface PlayerState {
  life: number;
  deck: CardInstance[];
  hand: CardInstance[];
  slots: Array<CardInstance | null>;
  sigils: Array<CardInstance | null>;
  cycle: number;
  cardsDrawn: number;
  discard?: CardInstance[];
}

export interface Eruption { instanceId: string; side: Side; nextWaveAtMs: number; wave: number; }
export interface GameState {
  eruptions?: Eruption[];
  phase: GamePhase;
  winner: Side | null;
  clockMs: number;
  preparationEndsAtMs: number | null;
  startAnnouncementEndsAtMs: number | null;
  nextAiAtMs: number;
  aiStarted: boolean;
  attackIntervalMs: number;
  aiActionIntervalMs: number;
  rngState: number;
  nextInstanceNumber: number;
  players: Record<Side, PlayerState>;
}

export type GameEvent =
  | { type: 'preparation-start'; endsAtMs: number }
  | { type: 'preparation-end' }
  | { type: 'combat-start' }
  | { type: 'draw'; side: Side; instanceId: string }
  | { type: 'place'; side: Side; instanceId: string; slot: number }
  | { type: 'move'; side: Side; instanceId: string; from: number; to: number }
  | { type: 'return'; side: Side; instanceId: string; slot: number }
  | { type: 'attack'; side: Side; attackerId: string; targetId?: string; targetSide: Side; targetSlot?: number; direct: boolean }
  | { type: 'target'; side: Side; attackerId: string; targetId: string; targetSlot: number }
  | { type: 'damage'; side: Side; instanceId: string; amount: number; destroyed: boolean }
  | { type: 'heal'; side: Side; instanceId: string; amount: number }
  | { type: 'life-damage'; side: Side; amount: number; value: number }
  | { type: 'life-heal'; side: Side; amount: number; value: number }
  | { type: 'spell'; side: Side; instanceId: string; targetId?: string; targetSide: Side; targetSlot?: number; direct: boolean }
  | { type: 'reveal'; side: Side; instanceId: string; slot: number; definitionId?: string }
  | { type: 'resurrect'; side: Side; instanceId: string; slot: number }
  | { type: 'summon'; side: Side; instanceId: string; slot: number; sourceId: string }
  | { type: 'link'; side: Side; instanceId: string; targetId?: string }
  | { type: 'root'; side: Side; instanceId: string; untilMs: number }
  | { type: 'volcano-wave'; side: Side; instanceId: string; wave: number }
  | { type: 'recycle'; side: Side; cycle: number }
  | { type: 'game-over'; winner: Side }
  | { type: 'game-draw' };

export interface Transition {
  state: GameState;
  events: GameEvent[];
}

export type SpellTarget =
  | { kind: 'unit'; side: Side; slot: number }
  | { kind: 'life'; side: Side };
