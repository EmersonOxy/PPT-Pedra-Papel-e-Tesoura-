import type { CardDefinition } from './types.ts';

export const cardDefinitions: CardDefinition[] = [
  { id: 'solemn-guardian', name: 'Morto Vivo', kind: 'troop', foundation: 'guarda', cost: 2, attack: 1, maxHealth: 6, attackAnimationProfile: 'impact', description: 'Ressurreição: volta uma vez à mesma posição com 2 de vida.', ability: 'resurrection', attackIntervalMs: 7000, abilityConfig: {"resurrectionHealth":2} },
  { id: 'astral-fox', name: 'Goblin Ladrão', kind: 'troop', foundation: 'tecnica', cost: 2, attack: 1, maxHealth: 4, attackAnimationProfile: 'advance', description: 'Saque: pode atingir diretamente o jogador da retaguarda e recuperar 1 de vida.', ability: 'plunder', attackIntervalMs: 7000, abilityConfig: {"healOnDirect":1} },
  { id: 'moss-colossus', name: 'Ogro Impiedoso', kind: 'troop', foundation: 'impacto', cost: 4, attack: 3, maxHealth: 11, attackAnimationProfile: 'impact', description: 'Esmagamento: excedente letal contra a frente atinge a retaguarda da mesma coluna.', ability: 'crush', attackIntervalMs: 10000, abilityConfig: {} },
  { id: 'amber-phoenix', name: 'Raposa Mística', kind: 'troop', foundation: 'tecnica', cost: 4, attack: 1, maxHealth: 4, attackAnimationProfile: 'spin', description: 'Vínculo Místico: na retaguarda, reduz em 1 segundo a recarga de um aliado vinculado.', ability: 'mystic-link', attackIntervalMs: 8000, abilityConfig: {"intervalReductionMs":1000} },
  { id: 'veil-oracle', name: 'Bruxa Necromante', kind: 'troop', foundation: 'tecnica', cost: 3, attack: 1, maxHealth: 5, attackAnimationProfile: 'pulse', description: 'Necromancia: uma vez enquanto esta Bruxa estiver viva, quando qualquer tropa aliada for eliminada em qualquer espaço do seu campo, invoca um Morto Vivo no espaço que ficou vazio. O invocado tem 1 de ataque e 2 de vida.', ability: 'necromancy', attackIntervalMs: 9000, abilityConfig: {"summonLimit":1,"summonHealth":2} },
  { id: 'vesper-blade', name: 'Raízes Verdejantes', kind: 'hidden', foundation: 'guarda', cost: 3, attack: 0, maxHealth: 0, attackAnimationProfile: 'advance', description: 'Oculta: cancela reposicionamento inimigo, prende por 4 segundos e atrasa o ataque em 2. Também pode ser ativada manualmente.', ability: 'roots', attackIntervalMs: 0, abilityConfig: {"rootDurationMs":4000,"delayMs":2000} },
  { id: 'ember-knight', name: 'Camponês Briguento', kind: 'troop', foundation: 'impacto', cost: 3, attack: 2, maxHealth: 6, attackAnimationProfile: 'impact', description: 'Fúria Desesperada: recebe +1 de ataque enquanto tiver 3 ou menos de vida.', ability: 'fury', attackIntervalMs: 7000, abilityConfig: {"furyThreshold":3,"furyBonus":1} },
  { id: 'eclipse-seal', name: 'Vulcão em Atividade', kind: 'hidden', foundation: 'impacto', cost: 2, attack: 0, maxHealth: 0, description: 'Oculta manual: três ondas a cada 4 segundos causam 2 de dano a TODOS os inimigos e 1 aos próprios aliados.', ability: 'volcano', attackIntervalMs: 0, abilityConfig: {"waveCount":3,"waveIntervalMs":4000,"enemyDamage":2,"allyDamage":1} },
  { id: 'sleeping-thorns', name: 'Armadilha de Espinhos', kind: 'hidden', foundation: 'guarda', cost: 2, attack: 0, maxHealth: 0, description: 'Oculta automática: antes de um ataque contra aliado, causa 2 ao atacante e atrasa o próximo ataque em 2 segundos.', ability: 'thorns', attackIntervalMs: 0, abilityConfig: {"damage":2,"delayMs":2000} },
  { id: 'runic-pulse', name: 'Cura Equivalente', kind: 'spell', foundation: 'guarda', cost: 2, attack: 0, maxHealth: 0, spellAmount: 2, effect: 'heal', description: 'Cura um aliado pelo dano do último golpe recebido, até 4 e sem exceder a vida máxima.', ability: 'equivalent-heal', attackIntervalMs: 0, abilityConfig: {"healCap":4} },
  { id: 'wandering-flame', name: 'Bola de Fogo', kind: 'spell', foundation: 'impacto', cost: 2, attack: 0, maxHealth: 0, spellAmount: 3, effect: 'damage', description: 'Causa 3 de dano à tropa inimiga escolhida e 1 à outra tropa da mesma coluna.', ability: 'fireball', attackIntervalMs: 0, abilityConfig: {"damage":3,"splashDamage":1} },
];

export const definitionsById = new Map(cardDefinitions.map((definition) => [definition.id, definition]));

export function getCardDefinition(id: string): CardDefinition {
  const definition = definitionsById.get(id);
  if (!definition) throw new Error(`Definição de carta desconhecida: ${id}`);
  return definition;
}
