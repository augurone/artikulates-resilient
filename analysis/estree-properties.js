import { primitiveLiteral } from './primitive-expressions.js';

export const primitivePropertyName = value => value === null || ['string', 'number', 'bigint', 'boolean', 'undefined'].includes(typeof value)
    ? { known: true, name: String(value) } : { known: false };

// Interpret property syntax only. Adapters still own whether a source is safe
// to consume; agreement owns the evidence retained from that source.
export const propertyName = ({ computed = false, key = {} } = {}) => {
    const { type = '', name = '' } = key;

    if (!computed && type === 'Identifier') return { known: true, name };

    if (type !== 'Literal') return { known: false };

    const { value = false } = key;

    if (['string', 'number'].includes(typeof value)) return { known: true, name: String(value) };

    return { known: false };
};

// Source evidence can normalize inert computed values. Syntax policies
// retain their existing propertyName spelling contract.
export const sourcePropertyName = ({ computed = false, key = {} } = {}) => {
    const { type: form = '', value = false, operator = '', argument: { type: operand = '', value: supplied = false } = {} } = key;

    if (form === 'Literal' && typeof value === 'bigint') return primitivePropertyName(value);

    if (!computed) return propertyName({ key });

    // Property-key conversion admits signed BigInt literals without extending
    // arithmetic evidence. Unary plus on a BigInt throws and stays unresolved.
    if (form === 'UnaryExpression' && operator === '-' && operand === 'Literal' && typeof supplied === 'bigint') return primitivePropertyName(-supplied);

    return propertyName({ computed, key: primitiveLiteral(key, operator) });
};

export const prototypeDefinition = ({ type = '', computed = false, method = false, shorthand = false, kind = 'init', key = {} } = {}) => {
    const { known = false, name = '' } = propertyName({ computed, key });

    return type === 'Property' && !computed && !method && !shorthand && kind === 'init' && known && name === '__proto__';
};
