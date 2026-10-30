import rawSessionConfig from '../../config/session.experimental.json' with { type: 'json' };
import { cardDefinitions } from './cards.ts';

export type PreparationAction = 'place' | 'move' | 'return' | 'cast' | 'reveal';
export type MatchFlowPhase = 'idle' | 'searching' | 'found' | 'countdown' | 'transition' | 'preparation' | 'starting' | 'battle' | 'finished';

export interface ExperimentalSessionConfig {
  matchmakingSearchMs: number;
  opponentFoundMessageMs: number;
  preMatchCountdownMs: number;
  transitionDurationMs: number;
  transitionCoverAtMs: number;
  preparationDurationMs: number;
  battleAnnouncementMs: number;
  preparationActions: Record<string, Record<PreparationAction, boolean>>;
}

export interface MatchFlowState {
  phase: MatchFlowPhase;
  elapsedMs: number;
  arenaMounted: boolean;
}

export type MatchFlowEvent = 'opponent-found' | 'countdown-start' | 'transition-start' | 'mount-arena' | 'transition-complete';

const preparationActions: PreparationAction[] = ['place', 'move', 'return', 'cast', 'reveal'];
const durationKeys = [
  'matchmakingSearchMs', 'opponentFoundMessageMs', 'preMatchCountdownMs', 'transitionDurationMs',
  'transitionCoverAtMs', 'preparationDurationMs', 'battleAnnouncementMs',
] as const;

export function validateExperimentalSessionConfig(input: unknown, cardIds = cardDefinitions.map((card) => card.id)): ExperimentalSessionConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A configuração de sessão precisa ser um objeto.');
  const value = input as Record<string, unknown>;
  for (const key of durationKeys) {
    if (!Number.isFinite(value[key]) || (value[key] as number) <= 0) throw new Error(`${key} precisa ser um número finito maior que zero.`);
  }
  if ((value.transitionCoverAtMs as number) >= (value.transitionDurationMs as number)) {
    throw new Error('transitionCoverAtMs precisa ocorrer antes do fim da transição.');
  }
  const permissions = value.preparationActions;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) throw new Error('preparationActions precisa mapear cada carta por ID.');
  const configuredIds = Object.keys(permissions);
  if (configuredIds.some((id) => !cardIds.includes(id)) || cardIds.some((id) => !configuredIds.includes(id))) {
    throw new Error('preparationActions precisa conter exatamente os IDs das cartas do catálogo.');
  }
  for (const id of cardIds) {
    const cardPermissions = (permissions as Record<string, unknown>)[id];
    if (!cardPermissions || typeof cardPermissions !== 'object' || Array.isArray(cardPermissions)) throw new Error(`Permissões de preparação inválidas para ${id}.`);
    const entries = cardPermissions as Record<string, unknown>;
    if (Object.keys(entries).some((action) => !preparationActions.includes(action as PreparationAction))
      || preparationActions.some((action) => typeof entries[action] !== 'boolean')) {
      throw new Error(`Ações de preparação inválidas para ${id}; cada permissão deve ser booleana e conhecida.`);
    }
  }
  return value as unknown as ExperimentalSessionConfig;
}

export const sessionConfig = validateExperimentalSessionConfig(rawSessionConfig);

export function isPreparationActionAllowed(cardId: string, action: PreparationAction): boolean {
  return sessionConfig.preparationActions[cardId]?.[action] === true;
}

export function createMatchFlow(): MatchFlowState {
  return { phase: 'idle', elapsedMs: 0, arenaMounted: false };
}

export function beginDemoMatchSearch(state: MatchFlowState): MatchFlowState {
  if (state.phase !== 'idle') return state;
  return { phase: 'searching', elapsedMs: 0, arenaMounted: false };
}

export function cancelDemoMatchSearch(state: MatchFlowState): MatchFlowState {
  if (state.phase !== 'searching') return state;
  return createMatchFlow();
}

export function setMatchFlowPhase(state: MatchFlowState, phase: MatchFlowPhase): MatchFlowState {
  return { ...state, phase, elapsedMs: 0 };
}

/** Advances the local demo matchmaking and curtain without network or wall-clock dependencies. */
export function advanceMatchFlow(state: MatchFlowState, deltaMs: number): { state: MatchFlowState; events: MatchFlowEvent[] } {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0 || state.phase === 'idle' || state.phase === 'preparation' || state.phase === 'starting' || state.phase === 'battle' || state.phase === 'finished') {
    return { state, events: [] };
  }
  let next = { ...state };
  let remaining = Math.min(deltaMs, 60_000);
  const events: MatchFlowEvent[] = [];
  let safety = 0;
  while (remaining > 0 && safety++ < 16) {
    const duration = next.phase === 'searching' ? sessionConfig.matchmakingSearchMs
      : next.phase === 'found' ? sessionConfig.opponentFoundMessageMs
        : next.phase === 'countdown' ? sessionConfig.preMatchCountdownMs
          : sessionConfig.transitionDurationMs;
    if (next.phase === 'transition' && !next.arenaMounted) {
      const untilCover = Math.max(0, sessionConfig.transitionCoverAtMs - next.elapsedMs);
      const step = Math.min(remaining, untilCover);
      next.elapsedMs += step;
      remaining -= step;
      if (next.elapsedMs >= sessionConfig.transitionCoverAtMs && !next.arenaMounted) {
        next.arenaMounted = true;
        events.push('mount-arena');
      }
      if (remaining <= 0) break;
      continue;
    }
    const step = Math.min(remaining, duration - next.elapsedMs);
    next.elapsedMs += step;
    remaining -= step;
    if (next.elapsedMs < duration) break;
    if (next.phase === 'searching') {
      next = { ...next, phase: 'found', elapsedMs: 0 };
      events.push('opponent-found');
    } else if (next.phase === 'found') {
      next = { ...next, phase: 'countdown', elapsedMs: 0 };
      events.push('countdown-start');
    } else if (next.phase === 'countdown') {
      next = { ...next, phase: 'transition', elapsedMs: 0, arenaMounted: false };
      events.push('transition-start');
    } else {
      next = { ...next, phase: 'preparation', elapsedMs: 0 };
      events.push('transition-complete');
      break;
    }
  }
  return { state: next, events };
}
