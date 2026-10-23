import { balance } from '../game/config.ts';
import type { CardDefinition, CardInstance, CardKind, Side } from '../game/types.ts';
import { renderPlaceholderIllustration } from './card-art.ts';

export type CardBackgroundId = 'red' | 'green' | 'blue' | 'purple' | 'yellow';
export type CardSigilId = 'crystal-green' | 'crystal-purple' | 'crystal-orange';
export type CardFaceContext = 'hand' | 'field' | 'preview';

export interface CardPresentation {
  background: CardBackgroundId;
  illustration: { kind: 'placeholder'; motif: string } | { kind: 'image'; src: string };
}

// These are provisional visual choices only. They do not encode card type, power, or combat rules.
export const cardPresentationCatalog: Record<string, CardPresentation> = {
  'solemn-guardian': { background: 'green', illustration: { kind: 'placeholder', motif: 'guardian' } },
  'astral-fox': { background: 'purple', illustration: { kind: 'image', src: new URL('../assets/card-art/Goblin Ladrão.png', import.meta.url).href } },
  'moss-colossus': { background: 'blue', illustration: { kind: 'placeholder', motif: 'golem' } },
  'amber-phoenix': { background: 'red', illustration: { kind: 'placeholder', motif: 'phoenix' } },
  'veil-oracle': { background: 'yellow', illustration: { kind: 'placeholder', motif: 'oracle' } },
  'vesper-blade': { background: 'purple', illustration: { kind: 'placeholder', motif: 'blade' } },
  'prism-sentinel': { background: 'green', illustration: { kind: 'placeholder', motif: 'crystal' } },
  'ember-knight': { background: 'red', illustration: { kind: 'image', src: new URL('../assets/card-art/Campones.png', import.meta.url).href } },
  'eclipse-seal': { background: 'purple', illustration: { kind: 'placeholder', motif: 'eclipse' } },
  'sleeping-thorns': { background: 'green', illustration: { kind: 'placeholder', motif: 'thorns' } },
  'runic-pulse': { background: 'blue', illustration: { kind: 'placeholder', motif: 'pulse' } },
  'wandering-flame': { background: 'red', illustration: { kind: 'placeholder', motif: 'wildfire' } },
};

export const sigilByCardKind: Record<CardKind, CardSigilId> = {
  troop: 'crystal-green',
  spell: 'crystal-orange',
  hidden: 'crystal-purple',
};

const backgroundAssets: Record<CardBackgroundId, string> = {
  red: new URL('../assets/card-system/background-red.png', import.meta.url).href,
  green: new URL('../assets/card-system/background-green.png', import.meta.url).href,
  blue: new URL('../assets/card-system/background-blue.png', import.meta.url).href,
  purple: new URL('../assets/card-system/background-purple.png', import.meta.url).href,
  yellow: new URL('../assets/card-system/background-yellow.png', import.meta.url).href,
};

const sigilAssets: Record<CardSigilId, string> = {
  'crystal-green': new URL('../assets/card-system/sigil-green.png', import.meta.url).href,
  'crystal-purple': new URL('../assets/card-system/sigil-purple.png', import.meta.url).href,
  'crystal-orange': new URL('../assets/card-system/sigil-orange.png', import.meta.url).href,
};

const frameAsset = new URL('../assets/card-system/frame.png', import.meta.url).href;
const cardBackAsset = new URL('../assets/card-system/card-back.png', import.meta.url).href;

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function renderCardBack(side: Side): string {
  return `<div class="card-back" data-side="${side}" role="img" aria-label="Carta de sigilo oculta">
    <img class="card-back__image" src="${cardBackAsset}" alt="" aria-hidden="true" draggable="false">
  </div>`;
}

export function renderDeckCardBack(): string {
  return `<img class="deck-card-back" src="${cardBackAsset}" alt="" aria-hidden="true" draggable="false">`;
}

function statValues(definition: CardDefinition, card: CardInstance): { left: number | null; right: number | null; labels: [string, string] } {
  if (definition.kind === 'troop') return { left: definition.attack, right: card.health, labels: ['Ataque', 'Vida atual'] };
  if (definition.kind === 'spell') {
    const effectValue = definition.spellAmount ?? (definition.effect === 'damage' ? balance.spellDamage : balance.spellHealing);
    return { left: definition.cost, right: effectValue, labels: ['Custo demonstrativo', definition.effect === 'damage' ? 'Dano do feitiço' : 'Cura do feitiço'] };
  }
  return { left: definition.cost, right: null, labels: ['Custo demonstrativo', 'Efeito'] };
}

export function renderCardFace(definition: CardDefinition, card: CardInstance, side: Side, context: CardFaceContext): string {
  const presentation = cardPresentationCatalog[definition.id];
  if (!presentation) throw new Error(`Apresentação visual ausente para ${definition.id}`);
  const sigil = sigilByCardKind[definition.kind];
  const values = statValues(definition, card);
  const accessible = `Ilustração provisória. ${definition.name}. ${values.labels[0]} ${values.left ?? 'não definido'}; ${values.labels[1]} ${values.right ?? 'ainda não definido nesta versão'}. ${definition.description}`;
  const stateKey = `${definition.id}:${card.health}:${card.revealed ? 1 : 0}:${presentation.background}:${sigil}`;
  const placeholder = presentation.illustration.kind === 'placeholder'
    ? `<span class="card-face__placeholder-tag">Ilustração provisória</span>${renderPlaceholderIllustration(presentation.illustration.motif)}`
    : `<img class="card-face__art-image" src="${escapeHtml(presentation.illustration.src)}" alt="" draggable="false">`;
  return `<div class="card-face card-face--${context} card-kind--${definition.kind}" data-background="${presentation.background}" data-sigil="${sigil}" data-visual-state="${stateKey}" data-side="${side}" role="img" aria-label="${escapeHtml(accessible)}">
    <img class="card-face__background" src="${backgroundAssets[presentation.background]}" alt="" aria-hidden="true" draggable="false">
    <div class="card-face__illustration${presentation.illustration.kind === 'image' ? ' card-face__illustration--image' : ''}" aria-hidden="true">${placeholder}</div>
    <img class="card-face__sigil" src="${sigilAssets[sigil]}" alt="" aria-hidden="true" draggable="false">
    <span class="card-face__name" title="${escapeHtml(definition.name)}">${escapeHtml(definition.name)}</span>
    <span class="card-face__stat card-face__stat--blue" aria-label="${values.labels[0]} ${values.left ?? 'não definido'}">${values.left ?? ''}</span>
    <span class="card-face__stat card-face__stat--red" aria-label="${values.labels[1]} ${values.right ?? 'ainda não definido nesta versão'}">${values.right ?? ''}</span>
    <span class="card-face__description">${escapeHtml(definition.description)}</span>
    <img class="card-face__frame" src="${frameAsset}" alt="" aria-hidden="true" draggable="false">
    <span class="card-face__sr-only">${escapeHtml(accessible)}</span>
  </div>`;
}
