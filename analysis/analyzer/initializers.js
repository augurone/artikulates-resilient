import { put } from '../collections.js';
import { primitiveLiteral } from '../primitive-expressions.js';
import { traverse } from '../traversal.js';
import { ownsRecordFields } from './records.js';

const primitiveKey = ({ type = '', regex = false } = {}) => type === 'Literal' && !regex;

// The intrinsic undefined is absent only when lexical resolution found no
// binding. A same-spelled formal, import, TDZ or outer binding owns its value.
export const intrinsicAbsence = (node = {}, identities = new WeakMap()) => {
    const { type = '', name = '' } = node;

    return type === 'Identifier' && name === 'undefined' && !identities.has(node);
};

export const acquireInitializers = ({ initializers = [], identities = new WeakMap(), inert = new WeakMap() } = {}) => {
    initializers.forEach(({ node = {} } = {}) => traverse(node, { enter: (current = {}) => {
        const { type = '', operator = '', argument = false, elements = [], properties = [] } = current;

        if (inert.has(current)) return [];

        if (type === 'ArrayExpression') return elements.filter(Boolean);

        if (ownsRecordFields(current)) return properties.flatMap(({ type = '', value = {}, computed = false, key = {} } = {}) => (
            type === 'Property' ? [...(computed ? [key] : []), value] : []
        ));

        return type === 'UnaryExpression' && operator === 'void' ? [argument] : [];
    }, leave: (current = {}) => {
        if (inert.has(current)) return;

        const { type = '', operator = '', argument = false, elements = [], properties = [] } = current;
        const { type: normalized = '' } = primitiveLiteral(current, operator);
        const supported = normalized === 'Literal' || ['ArrowFunctionExpression', 'FunctionExpression'].includes(type) || intrinsicAbsence(current, identities) ||
            (type === 'ArrayExpression' && elements.filter(Boolean).every(value => inert.get(value))) ||
            (ownsRecordFields(current) && properties.every(({ type = '', computed = false, key = {}, value = {} } = {}) => (
                type === 'Property' && (!computed || primitiveKey(key)) && inert.get(value)
            ))) ||
            (type === 'UnaryExpression' && operator === 'void' && inert.get(argument));

        put(inert, current, Boolean(supported));
    } }));

    return inert;
};
