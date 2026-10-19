import type { EditorCatalog, EditorProperty, VisualConfig } from '../types';

export const ASSETS = [
  { id: 'hands.rock', label: 'Pedra', file: 'hand-rock.png' },
  { id: 'hands.paper', label: 'Papel', file: 'hand-paper.png' },
  { id: 'hands.scissors', label: 'Tesoura', file: 'hand-scissors.png' },
] as const;
export const FONT_FAMILIES = ['system-ui', 'Arial', 'Georgia', 'Trebuchet MS', 'Verdana'] as const;

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
  fontFamily: 'Família da fonte',
  fontSize: 'Tamanho da fonte',
  fontWeight: 'Peso do texto',
  textAlign: 'Alinhamento',
  textColor: 'Cor do texto',
  opacity: 'Opacidade',
  visible: 'Visível',
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

export function validateClientValue(property: EditorProperty, value: unknown): boolean {
  if (property.type === 'text') return typeof value === 'string' && value.length <= (property.maxLength || 80);
  if (property.type === 'color') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (property.type === 'imageAsset') return typeof value === 'string' && ASSETS.some((asset) => asset.id === value);
  if (property.type === 'fontFamily' || property.type === 'textAlign') return typeof value === 'string' && property.options?.some((option) => option === value) === true;
  if (property.type === 'fontSize' || property.type === 'opacity') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < (property.min ?? -Infinity) || value > (property.max ?? Infinity)) return false;
    const step = property.step || 1;
    return Math.abs((value - (property.min || 0)) / step - Math.round((value - (property.min || 0)) / step)) < 1e-7;
  }
  if (property.type === 'fontWeight') return typeof value === 'number' && property.options?.some((option) => option === value) === true;
  if (property.type === 'boolean') return typeof value === 'boolean';
  return false;
}

function validateClientBinding(property: EditorProperty): boolean {
  const binding = property.binding;
  if (binding.operation === 'textContent') return property.type === 'text';
  if (binding.operation === 'imageSource') return property.type === 'imageAsset';
  if (binding.operation === 'visibility') return property.type === 'boolean';
  if (binding.operation === 'firstChildBackground') return property.type === 'color';
  if (binding.operation !== 'styleVariable') return false;
  const supported: Record<string, string> = {
    '--arena-background': 'color', '--move-button-background': 'color',
    '--studio-background-color': 'color', '--studio-text-color': 'color',
    '--studio-font-family': 'fontFamily', '--studio-font-size': 'fontSize',
    '--studio-font-weight': 'fontWeight', '--studio-text-align': 'textAlign', '--studio-opacity': 'opacity',
  };
  return supported[binding.name] === property.type;
}

export function validateClientConfig(catalog: EditorCatalog, config: VisualConfig): void {
  if (![1, 2, 3].includes(catalog.version) || config.schemaVersion !== catalog.version || !Array.isArray(catalog.elements)) {
    throw new Error('O catálogo ou a configuração usa uma versão incompatível.');
  }
  const definitions = new Map(catalog.elements.map((element) => [element.id, element]));
  const ids = new Set<string>();
  for (const element of catalog.elements) {
    if (ids.has(element.id) || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(element.id)) {
      throw new Error('O catálogo contém IDs duplicados ou inválidos.');
    }
    ids.add(element.id);
    for (const property of element.properties) {
      if (!validateClientBinding(property) || !validateClientValue(property, property.default)) throw new Error(`A propriedade ${property.key} em ${element.id} está fora do catálogo seguro.`);
    }
  }
  for (const [id, entry] of Object.entries(config.elements)) {
    const definition = definitions.get(id);
    if (!definition) throw new Error(`O elemento ${id} não está registrado no catálogo.`);
    for (const [key, value] of Object.entries(entry.base || {})) {
      const property = definition.properties.find((item) => item.key === key);
      if (!property || !validateClientBinding(property) || !validateClientValue(property, value)) {
        throw new Error(`O valor de ${ELEMENT_LABELS[id] || id} não é permitido.`);
      }
    }
    for (const [breakpoint, values] of Object.entries(entry.responsive || {})) {
      if (!['mobile', 'tablet'].includes(breakpoint) || !values || typeof values !== 'object') throw new Error(`O breakpoint responsivo de ${id} não é permitido.`);
      for (const [key, value] of Object.entries(values)) {
        const property = definition.properties.find((item) => item.key === key);
        if (!property?.responsive || !validateClientBinding(property) || !validateClientValue(property, value)) throw new Error(`O override responsivo ${id}.${key} não é permitido.`);
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
