import { traverse } from '../traversal.js';
import { append, put } from './collections.js';

// Parser payloads are external, polymorphic data. Their absence is not a value
// family, and extracting them must not create evidence through a default.
// eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- ESTree owns the literal payload; preserve its supplied value or natural absence without inventing a literal family.
export const literalValue = ({ value } = {}) => value;

export const snapshotLiteral = (node) => {
    const { type = '', regex = false } = node;
    const value = literalValue(node);

    return structuredClone({ type, value, ...(regex ? { regex } : {}) });
};

const projections = new Map([
    ['complete', ['family', 'content', 'field']],
    ['family', ['family']],
    ['content', ['family', 'content']],
    ['presence', ['family', 'field']]
]);

export const retainsFacet = ({ projection = 'complete', kind = '' } = {}) => projections.get(projection).includes(kind);

const keyHeader = (key = {}) => {
    const { type = '', name = '' } = key;

    if (type === 'Literal') return snapshotLiteral(key);

    return type === 'Identifier' ? { type, name } : { type };
};
const propertyHeader = ({ type = '', computed = false, method = false, shorthand = false, kind = 'init', key = {} } = {}) => ({
    type, computed, method, shorthand, kind, key: keyHeader(key)
});
const elementHeader = ({ type = '' } = {}) => ({ type });
const propertyValue = ({ value = false } = {}, acquire) => {
    if (!value) return {};

    if (typeof acquire !== 'function') throw new TypeError('Expected child evidence acquisition');

    return { value: acquire(value) };
};

// Own precisely the selected syntax before returning. Reduced structural
// snapshots contain headers, never caller nodes, nested value nodes or metadata.
const snapshotNode = ({ node = {}, projection = '', acquire } = {}) => {
    const { type = '' } = node;

    if (type === 'Literal') return snapshotLiteral(node);

    if (type === 'Identifier') {
        const { name = '' } = node;

        return { type, name };
    }

    if (['UnaryExpression', 'BinaryExpression'].includes(type)) {
        const { operator = '' } = node;

        return { type, operator };
    }

    if (projection === 'family') return { type };

    if (type === 'ArrayExpression' && ['content', 'complete'].includes(projection)) {
        const { elements = false } = node;

        // Elisions occupy non-spread slots but provide no element value.
        return { type, ...(Array.isArray(elements) ? { elements: Array.from(elements, element => elementHeader(element || {})) } : {}) };
    }

    if (type !== 'ObjectExpression') return { type };

    const { properties = false } = node;

    if (!Array.isArray(properties)) return { type };

    return { type, properties: properties.map((property) => {
        const header = propertyHeader(property);
        const { type: propertyType = '', kind = 'init' } = header;

        if (projection !== 'complete' || propertyType !== 'Property' || kind !== 'init') return header;

        return { ...header, ...propertyValue(property, acquire) };
    }) };
};
// Complete means all supported evidence, not every reachable host object.
// Private shells preserve shared child identity. They are filled before return;
// no caller node, parent metadata, function body or unsupported value is retained.
export const snapshotESTree = ({ node = {}, projection = 'complete' } = {}) => {
    if (!projections.has(projection)) throw new TypeError('Unsupported ESTree projection');

    if (projection !== 'complete') return snapshotNode({ node, projection });

    const snapshot = {};
    const owned = new WeakMap([[node, snapshot]]);

    traverse({ node, snapshot }, { enter: ({ node: source = {}, snapshot: target = {} } = {}) => {
        const children = [];
        const acquire = (child) => {
            if (owned.has(child)) return owned.get(child);

            const value = put(owned, child, {});

            append(children, { node: child, snapshot: value });

            return value;
        };
        const retained = snapshotNode({ node: source, projection, acquire });

        Object.defineProperties(target, Object.getOwnPropertyDescriptors(retained));

        return children;
    } });

    return snapshot;
};
