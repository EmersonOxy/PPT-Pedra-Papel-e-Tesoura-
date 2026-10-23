import { balance } from '../game/config.ts';
import { cardDefinitions } from '../game/cards.ts';
import type { CardDefinition } from '../game/types.ts';

/** UI-only sample data. It never changes card definitions or combat resolution. */
export const deckProgressionPreview = {
  level: 1,
  points: 0,
  pointsToNextLevel: 100,
} as const;

export interface DeckStatPreview {
  label: string;
  current: number;
  nextLevel: number;
}

export interface DeckSynergySuggestion {
  cardId: string;
  reason: string;
}

const suggestionIds: Record<string, DeckSynergySuggestion[]> = {
  'solemn-guardian': [{ cardId: 'runic-pulse', reason: 'A cura ajuda a manter a guardiã em campo.' }, { cardId: 'moss-colossus', reason: 'Duas tropas resistentes podem sustentar a linha.' }],
  'astral-fox': [{ cardId: 'runic-pulse', reason: 'A cura pode prolongar a presença da tropa.' }, { cardId: 'vesper-blade', reason: 'Duas tropas de golpes rápidos pressionam alvos.' }],
  'moss-colossus': [{ cardId: 'solemn-guardian', reason: 'Outra tropa resistente reforça a formação.' }, { cardId: 'sleeping-thorns', reason: 'Um sigilo pode complementar uma linha defensiva.' }],
  'amber-phoenix': [{ cardId: 'wandering-flame', reason: 'O feitiço também causa dano direto.' }, { cardId: 'ember-knight', reason: 'A dupla concentra pressão ofensiva.' }],
  'veil-oracle': [{ cardId: 'prism-sentinel', reason: 'As duas tropas têm descrições ligadas à leitura e guarda.' }, { cardId: 'runic-pulse', reason: 'A cura oferece suporte a tropas em campo.' }],
  'vesper-blade': [{ cardId: 'astral-fox', reason: 'Duas tropas de golpes precisos pressionam alvos.' }, { cardId: 'runic-pulse', reason: 'A cura pode prolongar a presença da tropa.' }],
  'prism-sentinel': [{ cardId: 'solemn-guardian', reason: 'As duas tropas têm foco em guarda.' }, { cardId: 'runic-pulse', reason: 'A cura oferece suporte a tropas em campo.' }],
  'ember-knight': [{ cardId: 'wandering-flame', reason: 'O feitiço também causa dano direto.' }, { cardId: 'amber-phoenix', reason: 'A dupla concentra pressão ofensiva.' }],
  'eclipse-seal': [{ cardId: 'veil-oracle', reason: 'O sigilo e a tropa compartilham tema ligado ao véu.' }, { cardId: 'sleeping-thorns', reason: 'Dois sigilos podem compor uma defesa preparada.' }],
  'sleeping-thorns': [{ cardId: 'moss-colossus', reason: 'A tropa resistente combina com uma defesa preparada.' }, { cardId: 'eclipse-seal', reason: 'Dois sigilos podem compor uma defesa preparada.' }],
  'runic-pulse': [{ cardId: 'solemn-guardian', reason: 'A cura pode manter a tropa resistente em campo.' }, { cardId: 'prism-sentinel', reason: 'A cura oferece suporte a uma tropa defensiva.' }],
  'wandering-flame': [{ cardId: 'amber-phoenix', reason: 'A tropa e o feitiço concentram dano.' }, { cardId: 'ember-knight', reason: 'A tropa e o feitiço concentram dano.' }],
};

export function deckStatsFor(definition: CardDefinition): DeckStatPreview[] {
  if (definition.kind === 'troop') return [
    { label: 'Ataque', current: definition.attack, nextLevel: definition.attack + 1 },
    { label: 'Vida', current: definition.maxHealth, nextLevel: definition.maxHealth + 1 },
  ];
  if (definition.kind === 'spell') {
    const amount = definition.effect === 'damage' ? balance.spellDamage : balance.spellHealing;
    return [{ label: definition.effect === 'damage' ? 'Dano' : 'Cura', current: amount, nextLevel: amount + 1 }];
  }
  return [];
}

export function synergiesFor(cardId: string): Array<DeckSynergySuggestion & { definition: CardDefinition }> {
  const byId = new Map(cardDefinitions.map((definition) => [definition.id, definition]));
  return (suggestionIds[cardId] ?? []).flatMap((suggestion) => {
    const definition = byId.get(suggestion.cardId);
    return definition ? [{ ...suggestion, definition }] : [];
  });
}
