import { propertyName, prototypeDefinition } from '../estree-properties.js';
import { put } from './collections.js';
import { literalValue } from './estree.js';
import { work } from './observation.js';

// Read already-owned ESTree structure. No runtime expressions, accessors, or
// callbacks are evaluated. Unknown syntax remains unknown evidence.
const knownFamilies = new Map(['array', 'object', 'function', 'regexp', 'nullish', 'string', 'number', 'boolean']
    .map(name => [name, Object.freeze({ families: Object.freeze([name]), incomplete: false })]));
const unknown = reason => ({ families: [], incomplete: true, reason });

// ESTree literal payloads preserve absence; a default must not invent evidence.
export const nodeFamily = (node = {}) => {
    const { type = '', regex = false, operator = '' } = node;

    if (type === 'ArrayExpression') return knownFamilies.get('array');

    if (type === 'ObjectExpression') return knownFamilies.get('object');

    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(type)) return knownFamilies.get('function');

    if (type === 'UnaryExpression' && operator === 'typeof') return knownFamilies.get('string');

    if ((type === 'UnaryExpression' && operator === '!') || (type === 'BinaryExpression' &&
        ['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'in', 'instanceof'].includes(operator))) return knownFamilies.get('boolean');

    if (type !== 'Literal') return unknown('Unsupported expression');

    if (regex) return knownFamilies.get('regexp');

    const value = literalValue(node);

    if (value === null) return knownFamilies.get('nullish');

    if (['string', 'number', 'boolean'].includes(typeof value)) return knownFamilies.get(typeof value);

    return unknown('Unsupported literal family');
};

const isSpread = ({ type = '' } = {}) => type === 'SpreadElement';
const nonSpreadElement = element => !element || !isSpread(element);

const knownProperty = (property) => {
    const { type = '' } = property;

    if (type !== 'Property' || prototypeDefinition(property)) return false;

    const { known = false } = propertyName(property);

    return known;
};

export const nodeContent = (node = {}) => {
    const { type = '', elements = false, properties = false } = node;
    const value = type === 'Literal' ? literalValue(node) : false;

    if (type === 'Literal' && typeof value === 'string') return { observations: [{ family: 'string', nonempty: Boolean(value.length) }], incomplete: false };

    if (type === 'ArrayExpression' && Array.isArray(elements) && !elements.length) return { observations: [{ family: 'array', nonempty: false }], incomplete: false };

    if (type === 'ArrayExpression' && Array.isArray(elements) && elements.some(nonSpreadElement)) {
        return { observations: [{ family: 'array', nonempty: true }], incomplete: false };
    }

    if (type === 'ObjectExpression' && Array.isArray(properties) && !properties.length) return { observations: [{ family: 'object', nonempty: false }], incomplete: false };

    if (type === 'ObjectExpression' && Array.isArray(properties) && properties.some(knownProperty)) {
        return { observations: [{ family: 'object', nonempty: true }], incomplete: false };
    }

    return { observations: [], incomplete: true, reason: 'Insufficient content evidence' };
};

// Owned syntax never changes. Index writer headers once on first field demand;
// later fields use the same layout without classifying any property values.
const layouts = new WeakMap();
const fieldLayout = ({ node = {}, observation = {} } = {}) => {
    if (layouts.has(node)) return layouts.get(node);

    const { properties = [] } = node;
    const writers = properties.map((property = {}) => {
        const { type: propertyType = '' } = property;
        const { known = false, name: key = '' } = propertyName(property);

        work(observation, 'field-index-entry');

        return { property, key, known: propertyType === 'Property' && !prototypeDefinition(property) && known };
    });
    const barrier = writers.findLastIndex(({ known = false } = {}) => !known);
    const entries = new Map(writers.flatMap(({ known = false, key = '', property = {} } = {}, index) => known ? [[key, { property, index }]] : []));

    return put(layouts, node, { entries, barrier });
};

export const nodeField = ({ node = {}, name = '', observation = {} } = {}) => {
    const { type = '', properties = false } = node;

    if (type !== 'ObjectExpression') return { cases: [{ state: 'unknown', reason: 'Unsupported own-field source' }] };

    if (!Array.isArray(properties)) return { cases: [{ state: 'unknown', reason: 'Own-field structure was not retained' }] };

    const { entries = new Map(), barrier = -1 } = fieldLayout({ node, observation });

    if (!entries.has(name)) {
        return { cases: [barrier >= 0 ? { state: 'unknown', reason: 'Unresolved property writer' } : { state: 'absent' }] };
    }

    const { property: { value = false, kind = 'init' } = {}, index = -1 } = entries.get(name);

    // Later unresolved writers can replace a value, but cannot remove an own
    // property established while constructing this fresh record.
    if (index < barrier) return { cases: [{ state: 'present', reason: 'Unresolved property overwrite' }] };

    if (kind !== 'init') return { cases: [{ state: 'present', reason: 'Accessor value is not evaluated' }] };

    return { cases: [{ state: 'present', node: value }] };
};
