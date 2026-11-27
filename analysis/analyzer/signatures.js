import { all, createOwner, fromESTree, readFamily } from 'eslint-plugin-resilient/agreement';

import { put } from '../collections.js';
import { sourcePropertyName as propertyName } from '../estree-properties.js';
import { primitiveLiteral } from '../primitive-expressions.js';
import { traverse } from '../traversal.js';
import { locationOf } from './locations.js';

const unrestricted = all();
const noDefault = Object.freeze({ supported: true, owner: false, expected: '' });

const defaultFor = (node = false) => {
    if (!node) return noDefault;

    const { type = '', operator = '', elements = [], properties = [] } = node;
    const { type: normalized = '' } = primitiveLiteral(node, operator);
    const supported = normalized === 'Literal' || ['ArrowFunctionExpression', 'FunctionExpression'].includes(type) ||
        (type === 'ArrayExpression' && !elements.length) || (type === 'ObjectExpression' && !properties.length);

    if (!supported) return { supported: false, owner: false, expected: '' };

    const owner = createOwner({ evidence: fromESTree(node) });
    const { families = [], incomplete = false } = readFamily({ owner });
    const [expected = ''] = families;

    return { supported: families.length === 1 && !incomplete, owner, expected };
};

const patternOf = (node = {}) => {
    const { type = '', left = {} } = node;

    return type === 'AssignmentPattern' ? left : node;
};
const fieldsOf = (node = {}) => {
    const { type = '', properties = [], elements = [] } = patternOf(node);

    if (type === 'ObjectPattern') return properties.filter(({ type = '' } = {}) => type === 'Property').map(({ value = {} } = {}) => value);

    return type === 'ArrayPattern' ? elements.filter(Boolean) : [];
};
const parameterFor = (node = {}, index, acquired = new WeakMap()) => {
    const { type: nodeType = '', left = {}, right = false } = node;
    const defaulted = nodeType === 'AssignmentPattern';
    const pattern = defaulted ? left : node;
    const { type = '', name = '', properties = [], elements = [] } = pattern;
    const { supported: defaultSupported = false, owner = false, expected: defaultFamily = '' } = defaultFor(defaulted ? right : false);
    const objectFields = type === 'ObjectPattern' ? properties.filter(({ type = '' } = {}) => type === 'Property').map((property) => {
        const { value = {} } = property;
        const { known = false, name = '' } = propertyName(property);
        const selected = acquired.get(value);
        const { supported = false } = selected;

        return Object.freeze({ ...selected, name, selectable: known, supported: known && supported });
    }) : [];
    const arrayFields = type === 'ArrayPattern' ? elements.flatMap((value, slot) => {
        if (!value) return [];

        const selected = acquired.get(value);
        const { rest = false } = selected;

        return [Object.freeze({ ...selected, name: String(slot), slot, selectable: !rest })];
    }) : [];
    const fields = [...objectFields, ...arrayFields];
    const { [type]: expected = defaultFamily } = { ObjectPattern: 'object', ArrayPattern: 'array' };

    return Object.freeze({
        index, name, defaulted, rest: type === 'RestElement', fallback: owner, expected, required: expected || unrestricted,
        complete: ['Identifier', 'ObjectPattern', 'ArrayPattern', 'RestElement'].includes(type),
        closed: type === 'ObjectPattern' && properties.every((property = {}) => {
            const { type = '' } = property;
            const { known = false } = propertyName(property);

            return type === 'Property' && known;
        }),
        fields: Object.freeze(fields), emptyArrayDefault: defaulted && defaultFamily === 'array',
        supported: ['Identifier', 'ObjectPattern', 'ArrayPattern', 'RestElement'].includes(type) && defaultSupported && fields.every(({ supported = false } = {}) => supported)
    });
};

export const acquireSignature = ({ node = {}, index = -1, arity = [] } = {}) => {
    const { params = [] } = node;
    const acquired = new WeakMap();

    params.forEach(node => traverse(node, { enter: fieldsOf,
        leave: current => put(acquired, current, parameterFor(current, -1, acquired)) }));
    const parameters = Object.freeze(params.map((node, index) => Object.freeze({ ...acquired.get(node), index })));
    const descriptor = Object.freeze({
        index, location: locationOf(node),
        parameters: Object.freeze(parameters.map(({ index: position = -1, defaulted = false, expected = '', fields = [] } = {}) => Object.freeze({
            index: position, defaulted, expected,
            fields: Object.freeze(fields.map(({ name = '', expected: family = '' } = {}) => Object.freeze({ name, expected: family })))
        })))
    });

    return Object.freeze({ parameters, descriptor, arity, supported: parameters.every(({ supported = false } = {}) => supported) });
};
