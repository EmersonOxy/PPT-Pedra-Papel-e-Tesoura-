import sceneCatalog from '../../scenes.json';

export interface StudioScene {
  id: string;
  label: string;
  description: string;
  screen: 'menu' | 'game';
  elementIds: string[];
  fixture: {
    kind: 'menu' | 'combat' | 'battle-result' | 'match-result';
    winner?: 'player' | 'enemy';
    reason?: 'points' | 'timeout';
    playerPoints?: number;
    enemyPoints?: number;
    battle?: number;
    playerHp?: number;
    enemyHp?: number;
    playerSign?: 'rock' | 'paper' | 'scissors';
    enemySign?: 'rock' | 'paper' | 'scissors';
    misses?: number;
    power?: 'heal' | 'defense' | 'critical' | null;
  };
}

export const STUDIO_SCENES = sceneCatalog.scenes as unknown as StudioScene[];
