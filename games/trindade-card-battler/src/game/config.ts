import rawBalance from '../../config/balance.experimental.json' with { type: 'json' };
import { cardDefinitions } from './cards.ts';

export interface FieldTopology {
  rows: number;
  columns: number;
  frontRow: Record<'player' | 'enemy', number>;
  specialSpaces: Array<{ kind: 'sigil'; count: number }>;
}

export interface ExperimentalBalance {
  rulesetId: string;
  startingLife: number;
  deckSize: number;
  copiesPerDefinition: number;
  handLimit: number;
  fieldTopology: FieldTopology;
  attackIntervalMs: number;
  aiInitialDelayMs: number;
  aiActionIntervalMs: number;
  spellDamage: number;
  spellHealing: number;
  note: string;
}

export function validateExperimentalBalance(input: unknown, definitionCount: number): ExperimentalBalance {
  if (!input || typeof input !== 'object') throw new Error('A configuração experimental precisa ser um objeto.');
  const value = input as Record<string, unknown>;
  const topology = value.fieldTopology as Record<string, unknown> | undefined;
  if (!topology || typeof topology !== 'object') throw new Error('fieldTopology é obrigatório.');
  const rows = topology.rows;
  const columns = topology.columns;
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || (rows as number) <= 0 || (columns as number) <= 0) {
    throw new Error('A topologia precisa declarar linhas e colunas inteiras positivas.');
  }
  if (rows !== 2 || columns !== 3) {
    throw new Error(`Topologia incompatível com a interface atual: recebido ${rows}x${columns}; suportado 2x3.`);
  }
  const frontRow = topology.frontRow as Record<string, unknown> | undefined;
  if (!frontRow || !Number.isInteger(frontRow.player) || !Number.isInteger(frontRow.enemy)
    || (frontRow.player as number) < 0 || (frontRow.player as number) >= (rows as number)
    || (frontRow.enemy as number) < 0 || (frontRow.enemy as number) >= (rows as number)) {
    throw new Error('A orientação frontRow precisa declarar uma linha válida para player e enemy.');
  }
  if (frontRow.player === frontRow.enemy) throw new Error('As linhas dianteiras dos lados precisam ser opostas nesta arena de duas linhas.');
  const specials = topology.specialSpaces;
  if (!Array.isArray(specials) || specials.some((space) => !space || typeof space !== 'object'
    || (space as Record<string, unknown>).kind !== 'sigil'
    || !Number.isInteger((space as Record<string, unknown>).count)
    || ((space as Record<string, unknown>).count as number) < 0)) {
    throw new Error('specialSpaces contém um espaço especial inválido ou ainda não suportado.');
  }
  const sigilKinds = specials.filter((space) => (space as Record<string, unknown>).kind === 'sigil');
  if (sigilKinds.length !== 1) throw new Error('A topologia deve declarar exatamente uma definição de espaços sigil.');
  const numericFields = ['startingLife', 'deckSize', 'copiesPerDefinition', 'handLimit', 'attackIntervalMs', 'aiInitialDelayMs', 'aiActionIntervalMs', 'spellDamage', 'spellHealing'];
  for (const key of numericFields) {
    if (!Number.isFinite(value[key]) || (value[key] as number) < 0) throw new Error(`${key} precisa ser um número finito não negativo.`);
  }
  for (const key of ['startingLife', 'deckSize', 'attackIntervalMs', 'aiActionIntervalMs']) {
    if ((value[key] as number) <= 0) throw new Error(`${key} precisa ser maior que zero.`);
  }
  if (!Number.isInteger(value.copiesPerDefinition) || (value.copiesPerDefinition as number) <= 0) throw new Error('copiesPerDefinition precisa ser inteiro positivo.');
  const expectedDeckSize = definitionCount * (value.copiesPerDefinition as number);
  if (value.deckSize !== expectedDeckSize) {
    throw new Error(`deckSize é uma restrição declarada: ${value.deckSize}; catálogo × cópias exige ${expectedDeckSize}.`);
  }
  if (!Number.isInteger(value.handLimit) || (value.handLimit as number) <= 0) throw new Error('handLimit precisa ser inteiro positivo.');
  if ((value.handLimit as number) > expectedDeckSize) throw new Error('handLimit não pode exceder deckSize.');
  return value as unknown as ExperimentalBalance;
}

export const balance = validateExperimentalBalance(rawBalance, cardDefinitions.length);
export const topology = balance.fieldTopology;
export const boardSlotCount = topology.rows * topology.columns;
export const sigilSlotCount = topology.specialSpaces.find((space) => space.kind === 'sigil')?.count ?? 0;
