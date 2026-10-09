import { all, createOwner, fromESTree, readFamily } from 'eslint-plugin-resilient/agreement';

import { put } from '../collections.js';
import { propertyName } from '../estree-properties.js';
import { traverse } from '../traversal.js';
import { locationOf } from './locations.js';

const unrestricted = all();
const noDefault = Object.freeze({ supported: true, owner: false, expected: '' });

const defaultFor = (node = false) => {
    if (!node) return noDefault;

    const { type = '', elements = [], properties = [] } = node;
    const supported = ['Literal', 'ArrowFunctionExpression', 'FunctionExpression'].includes(type) ||
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
    const { type = '', properties = [] } = patternOf(node);

    return type === 'ObjectPattern' ? properties : [];
};
const parameterFor = (node = {}, index, acquired = new WeakMap()) => {
    const { type: nodeType = '', left = {}, right = false } = node;
    const defaulted = nodeType === 'AssignmentPattern';
    const pattern = defaulted ? left : node;
    const { type = '', name = '', properties = [] } = pattern;
    const { supported: defaultSupported = false, owner = false, expected: defaultFamily = '' } = defaultFor(defaulted ? right : false);
    const fields = type === 'ObjectPattern' ? properties.filter(({ type = '' } = {}) => type === 'Property').map((property) => {
        const { computed = false, value = {} } = property;
        const { known = false, name = '' } = propertyName(property);
        const selected = acquired.get(value);
        const { supported = false } = selected;

        return Object.freeze({ ...selected, name, selectable: !computed && known, supported: !computed && known && supported });
    }) : [];
    const { [type]: expected = defaultFamily } = { ObjectPattern: 'object', ArrayPattern: 'array' };

    return Object.freeze({
        index, name, defaulted, rest: type === 'RestElement', fallback: owner, expected, required: expected || unrestricted,
        complete: ['Identifier', 'ObjectPattern', 'RestElement'].includes(type),
        closed: type === 'ObjectPattern' && properties.every(({ type = '', computed = false } = {}) => type === 'Property' && !computed),
        fields: Object.freeze(fields),
        supported: ['Identifier', 'ObjectPattern', 'RestElement'].includes(type) && defaultSupported && fields.every(({ supported = false } = {}) => supported)
    });
};

export const acquireSignature = ({ node = {}, index = -1, arity = [] } = {}) => {
    const { params = [] } = node;
    const acquired = new WeakMap();

    params.forEach(node => traverse(node, { enter: current => fieldsOf(current).filter(({ type = '' } = {}) => type === 'Property').map(({ value = {} } = {}) => value),
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
