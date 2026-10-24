import type { AiProfileId } from './types.ts';

export interface OpponentProfile {
  id: AiProfileId;
  name: string;
  style: string;
  deck: string[];
}

function deckFrom(core: string[], size = 24): string[] {
  return Array.from({ length: size }, (_, index) => core[index % core.length]!);
}

export const opponentProfiles: OpponentProfile[] = [
  {
    id: 'carmesim', name: 'Casa Carmesim', style: 'Equilibrada · ajusta a formação e os alvos',
    deck: deckFrom(['solemn-guardian', 'astral-fox', 'moss-colossus', 'amber-phoenix', 'veil-oracle', 'vesper-blade', 'ember-knight', 'eclipse-seal', 'sleeping-thorns', 'runic-pulse', 'wandering-flame']),
  },
  {
    id: 'bastilha', name: 'Bastião Verde', style: 'Defensiva · protege a frente e fortalece aliados',
    deck: deckFrom(['solemn-guardian', 'veil-oracle', 'amber-phoenix', 'sleeping-thorns', 'vesper-blade', 'runic-pulse', 'solemn-guardian', 'ember-knight']),
  },
  {
    id: 'predador', name: 'Matilha Rubra', style: 'Agressiva · avança tropas e pressiona a vida',
    deck: deckFrom(['moss-colossus', 'ember-knight', 'astral-fox', 'wandering-flame', 'eclipse-seal', 'moss-colossus', 'ember-knight', 'sleeping-thorns']),
  },
];

export function getOpponentProfile(id: AiProfileId): OpponentProfile {
  return opponentProfiles.find((profile) => profile.id === id) ?? opponentProfiles[0]!;
}
