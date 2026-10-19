import type { EditorCatalog, VisualConfig } from '../types';

export const ASSETS = [
  { id: 'hands.rock', label: 'Pedra', file: 'hand-rock.png' },
  { id: 'hands.paper', label: 'Papel', file: 'hand-paper.png' },
  { id: 'hands.scissors', label: 'Tesoura', file: 'hand-scissors.png' },
] as const;

export const ELEMENT_LABELS: Record<string, string> = {
  'game.title': 'Título do jogo',
  'menu.card': 'Cartão do menu',
  'menu.start': 'Botão Jogar',
  'arena.background': 'Fundo da arena',
  'hands.player.image': 'Mão do jogador',
  'hands.enemy.image': 'Mão do adversário',
  'hud.player.health': 'Vida do jogador',
  'hud.enemy.health': 'Vida do adversário',
  'controls.move.rock': 'Botão Pedra',
  'controls.move.paper': 'Botão Papel',
  'controls.move.scissors': 'Botão Tesoura',
};

export const PROPERTY_LABELS: Record<string, string> = {
  text: 'Texto',
  backgroundColor: 'Cor de fundo',
  fillColor: 'Cor da barra',
  assetId: 'Imagem',
};

export const KIND_LABELS: Record<string, string> = {
  text: 'Texto',
  image: 'Imagem',
  container: 'Área',
  button: 'Botão',
  meter: 'Indicador',
};

export function configSnapshot(config: VisualConfig): string {
  return JSON.stringify(config);
}

export function validateClientValue(type: string, value: unknown, maxLength = 80): value is string {
  if (type === 'text') return typeof value === 'string' && value.length <= maxLength;
  if (type === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (type === 'imageAsset') return typeof value === 'string' && ASSETS.some((asset) => asset.id === value);
  return false;
}

export function validateClientConfig(catalog: EditorCatalog, config: VisualConfig): void {
  if (![1, 2].includes(catalog.version) || config.schemaVersion !== catalog.version || !Array.isArray(catalog.elements)) {
    throw new Error('O catálogo ou a configuração usa uma versão incompatível.');
  }
  const definitions = new Map(catalog.elements.map((element) => [element.id, element]));
  const ids = new Set<string>();
  for (const element of catalog.elements) {
    if (ids.has(element.id) || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(element.id)) {
      throw new Error('O catálogo contém IDs duplicados ou inválidos.');
    }
    ids.add(element.id);
  }
  for (const [id, entry] of Object.entries(config.elements)) {
    const definition = definitions.get(id);
    if (!definition) throw new Error(`O elemento ${id} não está registrado no catálogo.`);
    for (const [key, value] of Object.entries(entry.base)) {
      const property = definition.properties.find((item) => item.key === key);
      if (!property || !validateClientValue(property.type, value, property.maxLength)) {
        throw new Error(`O valor de ${ELEMENT_LABELS[id] || id} não é permitido.`);
      }
    }
    if (entry.geometry) {
      const geometry = definition.geometry;
      if (!geometry || geometry.type !== 'flow-box-v1' || geometry.binding !== 'css-flow-box-v1'
        || Object.keys(entry.geometry).some((key) => !['base', 'responsive'].includes(key))) throw new Error(`Geometria não permitida em ${id}.`);
      const validateValues = (values: Record<string, number>) => {
        for (const [key, value] of Object.entries(values)) {
          const limits = geometry.limits[key as keyof typeof geometry.limits];
          if (!limits || !Number.isFinite(value) || value < limits.min || value > limits.max) throw new Error(`Geometria inválida em ${id}.${key}.`);
        }
      };
      validateValues(entry.geometry.base || {});
      for (const [breakpoint, values] of Object.entries(entry.geometry.responsive || {})) {
        if (!geometry.responsive || !['mobile', 'tablet'].includes(breakpoint)) throw new Error(`Breakpoint geométrico inválido em ${id}.`);
        validateValues(values);
      }
    }
  }
}
