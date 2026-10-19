const GEOMETRY_SCHEMA = 'flow-box-v1';
const GEOMETRY_FIELDS = new Set(['x', 'y', 'width', 'height']);
const BREAKPOINTS = new Set(['mobile', 'tablet']);

function validateGeometry(definition, geometry) {
  if (!definition || definition.type !== GEOMETRY_SCHEMA || definition.binding !== 'css-flow-box-v1' || definition.anchor !== 'flow') {
    throw new Error('A definição de geometria não é compatível com o binding permitido.');
  }
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)
    || Object.keys(geometry).some((key) => !['base', 'responsive'].includes(key))) {
    throw new Error('A geometria do elemento tem um formato inválido.');
  }
  const validateValues = (values) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)
      || Object.keys(values).some((key) => !GEOMETRY_FIELDS.has(key))) {
      throw new Error('A geometria contém uma propriedade não permitida.');
    }
    for (const [field, value] of Object.entries(values)) {
      const limits = definition.limits?.[field];
      if (!Number.isFinite(value) || !limits || value < limits.min || value > limits.max) {
        throw new Error(`Valor de geometria inválido em ${field}; use ${limits?.min} a ${limits?.max} px.`);
      }
    }
    if (values.width !== undefined && values.width < definition.limits.width.min) throw new Error('A largura mínima permitida foi excedida.');
    if (values.height !== undefined && values.height < definition.limits.height.min) throw new Error('A altura mínima permitida foi excedida.');
  };

  validateValues(geometry.base || {});
  if (geometry.responsive !== undefined) {
    if (!definition.responsive || !geometry.responsive || typeof geometry.responsive !== 'object' || Array.isArray(geometry.responsive)
      || Object.keys(geometry.responsive).some((breakpoint) => !BREAKPOINTS.has(breakpoint))) {
      throw new Error('Os overrides responsivos de geometria não são permitidos.');
    }
    for (const values of Object.values(geometry.responsive)) validateValues(values);
  }
  return geometry;
}

function rectanglesOverlap(first, second, tolerance = 1) {
  if (!first || !second || ![first.left, first.top, first.right, first.bottom, second.left, second.top, second.right, second.bottom].every(Number.isFinite)) return false;
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return width > tolerance && height > tolerance;
}

module.exports = { GEOMETRY_FIELDS, GEOMETRY_SCHEMA, rectanglesOverlap, validateGeometry };
