import type { CardDefinition } from './types.ts';

export const cardDefinitions: CardDefinition[] = [
  { id: 'solemn-guardian', name: 'Guardiã Solene', kind: 'troop', foundation: 'guarda', cost: 2, attack: 2, maxHealth: 4, description: 'Uma guardiã firme, feita para segurar a linha.' },
  { id: 'astral-fox', name: 'Raposa Astral', kind: 'troop', foundation: 'tecnica', cost: 2, attack: 3, maxHealth: 2, description: 'Rápida e precisa, mas vulnerável a impactos.' },
  { id: 'moss-colossus', name: 'Colosso de Musgo', kind: 'troop', foundation: 'guarda', cost: 4, attack: 2, maxHealth: 6, description: 'Uma muralha viva de pedra e musgo.' },
  { id: 'amber-phoenix', name: 'Fênix de Âmbar', kind: 'troop', foundation: 'impacto', cost: 4, attack: 5, maxHealth: 2, description: 'Uma chama intensa que atinge com força.' },
  { id: 'veil-oracle', name: 'Oráculo do Véu', kind: 'troop', foundation: 'tecnica', cost: 3, attack: 3, maxHealth: 3, description: 'Lê as correntes da batalha.' },
  { id: 'vesper-blade', name: 'Lâmina Vesperal', kind: 'troop', foundation: 'tecnica', cost: 3, attack: 4, maxHealth: 2, description: 'Golpes precisos antes que o inimigo reaja.' },
  { id: 'prism-sentinel', name: 'Sentinela Prismática', kind: 'troop', foundation: 'guarda', cost: 3, attack: 2, maxHealth: 5, description: 'Canaliza luz em uma guarda cristalina.' },
  { id: 'ember-knight', name: 'Cavaleiro da Brasa', kind: 'troop', foundation: 'impacto', cost: 3, attack: 4, maxHealth: 3, description: 'Um combatente incandescente.' },
  { id: 'eclipse-seal', name: 'Selo do Eclipse', kind: 'hidden', foundation: 'tecnica', cost: 2, attack: 0, maxHealth: 0, description: 'Sigilo demonstrativo. O gatilho final ainda não foi definido.' },
  { id: 'sleeping-thorns', name: 'Espinhos Dormentes', kind: 'hidden', foundation: 'guarda', cost: 2, attack: 0, maxHealth: 0, description: 'Sigilo demonstrativo. O gatilho final ainda não foi definido.' },
  { id: 'runic-pulse', name: 'Pulso Rúnico', kind: 'spell', foundation: 'guarda', cost: 2, attack: 0, maxHealth: 0, effect: 'heal', description: 'Recupera 2 pontos de vida de um alvo aliado.' },
  { id: 'wandering-flame', name: 'Chama Errante', kind: 'spell', foundation: 'impacto', cost: 2, attack: 0, maxHealth: 0, effect: 'damage', description: 'Causa 2 pontos de dano a um alvo inimigo.' },
];

export const definitionsById = new Map(cardDefinitions.map((definition) => [definition.id, definition]));

export function getCardDefinition(id: string): CardDefinition {
  const definition = definitionsById.get(id);
  if (!definition) throw new Error(`Definição de carta desconhecida: ${id}`);
  return definition;
}
