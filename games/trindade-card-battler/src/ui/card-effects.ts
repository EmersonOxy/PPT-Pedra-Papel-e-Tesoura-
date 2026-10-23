/** Presentation only: a hit reaction never blocks or reduces engine damage. */
export const cardEffects: Record<string, { color: string; trail: string; hit: string; death: string }> = {
  'solemn-guardian': { color: '#91d99b', trail: 'mist', hit: 'veil', death: 'mist' },
  'astral-fox': { color: '#e0c66c', trail: 'slash', hit: 'recoil', death: 'fall' },
  'moss-colossus': { color: '#dfb583', trail: 'impact', hit: 'brace', death: 'crumble' },
  'amber-phoenix': { color: '#86d9ff', trail: 'spark', hit: 'veil', death: 'mist' },
  'veil-oracle': { color: '#c59aff', trail: 'orb', hit: 'veil', death: 'mist' },
  'vesper-blade': { color: '#94dd79', trail: 'leaves', hit: 'brace', death: 'crumble' },
  'ember-knight': { color: '#ffc379', trail: 'impact', hit: 'recoil', death: 'fall' },
  'eclipse-seal': { color: '#ff8553', trail: 'orb', hit: 'brace', death: 'embers' },
  'sleeping-thorns': { color: '#9fce69', trail: 'leaves', hit: 'brace', death: 'crumble' },
  'runic-pulse': { color: '#8df0c0', trail: 'orb', hit: 'veil', death: 'mist' },
  'wandering-flame': { color: '#ff974d', trail: 'orb', hit: 'veil', death: 'embers' },
};
