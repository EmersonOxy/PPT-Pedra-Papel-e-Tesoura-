import type { CardDefinition } from './types.ts';

export const cardDefinitions: CardDefinition[] = [
  { id: 'solemn-guardian', name: 'Morto Vivo', kind: 'troop', foundation: 'guarda', cost: 2, attack: 2, maxHealth: 4, attackAnimationProfile: 'impact', description: 'Ataca automaticamente inimigos expostos quando a recarga termina.' },
  { id: 'astral-fox', name: 'Goblin Ladrão', kind: 'troop', foundation: 'tecnica', cost: 2, attack: 2, maxHealth: 4, attackAnimationProfile: 'advance', description: 'Ataca o alvo inimigo escolhido quando sua recarga termina.' },
  { id: 'moss-colossus', name: 'Ogro Impiedoso', kind: 'troop', foundation: 'guarda', cost: 4, attack: 2, maxHealth: 6, attackAnimationProfile: 'impact', description: 'Tropa resistente. Ataca automaticamente e protege a retaguarda da sua coluna.' },
  { id: 'amber-phoenix', name: 'Raposa Mística', kind: 'troop', foundation: 'impacto', cost: 4, attack: 3, maxHealth: 4, attackAnimationProfile: 'spin', description: 'Ataca inimigos expostos após sua recarga individual.' },
  { id: 'veil-oracle', name: 'Bruxa Necromante', kind: 'troop', foundation: 'tecnica', cost: 3, attack: 2, maxHealth: 4, attackAnimationProfile: 'pulse', description: 'Ataca inimigos expostos. Invocação de mortos ainda não implementada.' },
  { id: 'vesper-blade', name: 'Raízes Verdejantes', kind: 'troop', foundation: 'tecnica', cost: 3, attack: 3, maxHealth: 4, attackAnimationProfile: 'advance', description: 'Raízes vivas que atacam inimigos expostos após sua recarga.' },
  { id: 'ember-knight', name: 'Camponês Briguento', kind: 'troop', foundation: 'impacto', cost: 3, attack: 3, maxHealth: 4, attackAnimationProfile: 'impact', description: 'Ataca automaticamente após a recarga. Pode priorizar um inimigo exposto.' },
  { id: 'eclipse-seal', name: 'Vulcão em Atividade', kind: 'hidden', foundation: 'tecnica', cost: 2, attack: 0, maxHealth: 0, description: 'Carta oculta: coloque no espaço de sigilo e toque para revelar. Efeito em definição.' },
  { id: 'sleeping-thorns', name: 'Armadilha de Espinhos', kind: 'hidden', foundation: 'guarda', cost: 2, attack: 0, maxHealth: 0, description: 'Armadilha oculta: coloque no espaço de sigilo. O disparo ainda está em definição.' },
  { id: 'runic-pulse', name: 'Cura Equivalente', kind: 'spell', foundation: 'guarda', cost: 2, attack: 0, maxHealth: 0, spellAmount: 2, effect: 'heal', description: 'Recupera 2 pontos de vida de uma tropa aliada ou do jogador.' },
  { id: 'wandering-flame', name: 'Bola de Fogo', kind: 'spell', foundation: 'impacto', cost: 2, attack: 0, maxHealth: 0, spellAmount: 2, effect: 'damage', description: 'Causa 2 pontos de dano a uma tropa inimiga ou ao adversário.' },
];

export const definitionsById = new Map(cardDefinitions.map((definition) => [definition.id, definition]));

export function getCardDefinition(id: string): CardDefinition {
  const definition = definitionsById.get(id);
  if (!definition) throw new Error(`Definição de carta desconhecida: ${id}`);
  return definition;
}
