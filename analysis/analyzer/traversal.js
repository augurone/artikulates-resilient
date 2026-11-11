import { VisitorKeys } from 'espree';

import { append } from '../collections.js';
import { patternChildren } from '../estree-patterns.js';
import { traverse } from '../traversal.js';

export { patternChildren } from '../estree-patterns.js';
export { traverse } from '../traversal.js';

export const childrenOf = (node = {}) => {
    const { type = '' } = node;
    const { [type]: keys = [] } = VisitorKeys;

    return keys.flatMap((key) => {
        const { [key]: value = false } = node;

        if (Array.isArray(value)) return value.filter(Boolean);

        return value ? [value] : [];
    });
};

export const patternNames = (pattern) => {
    const names = [];

    traverse(pattern, { enter: (node = {}) => {
        const { type = '', name = '' } = node;

        if (type === 'Identifier') append(names, name);

        return patternChildren(node);
    } });

    return names;
};

// Each destructuring level owns its authored absence decision independently.
export const patternDeclarations = (pattern, observe) => {
    const declarations = [];

    traverse({ node: pattern }, { enter: ({ node = {}, parent = false, defaulted = false, rest = false, destructured = false, objectProperty = false } = {}) => {
        const { type = '', left = {}, argument = {}, value = {}, properties = [], elements = [] } = node;

        if (typeof observe === 'function') observe({ node, parent });

        if (type === 'AssignmentPattern') return [{ node: left, parent: node, defaulted: true, rest, destructured, objectProperty }];

        if (type === 'RestElement') return [{ node: argument, parent: node, rest: true, destructured }];

        if (type === 'Property') return [{ node: value, parent: node, destructured: true, objectProperty: true }];

        if (['Identifier', 'ObjectPattern', 'ArrayPattern'].includes(type)) append(declarations, { node, parent, defaulted, rest, destructured, objectProperty });

        return [...properties, ...elements.filter(Boolean)].map(child => ({ node: child, parent: node, destructured: true }));
    } });

    return declarations;
};
