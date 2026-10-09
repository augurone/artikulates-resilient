import { isFunctionType } from './ast-function.js';
import { extendTraversalPath, someTraversalChild } from './ast-traversal.js';
import {
    getObject,
    hasObjectValue,
    isObject
} from './object.js';

const LOOP_TYPES = [
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement'
];

const LOOP_CONTROL_TYPES = [
    'BreakStatement',
    'ContinueStatement',
    'ReturnStatement',
    'ThrowStatement'
];

const isAncestor = ({ ancestor = {}, node = {} } = {}) => {
    if (!hasObjectValue(node)) return false;

    if (node === ancestor) return true;

    const { parent = {} } = node;

    return isAncestor({ ancestor, node: parent });
};

const getLabeledAncestor = ({ node = {}, name = '' } = {}) => {
    if (!hasObjectValue(node)) return {};

    const {
        type = '',
        label = {},
        parent: next = {}
    } = node;
    const { name: currentName = '' } = getObject(label);

    if (type === 'LabeledStatement' && currentName === name) return node;

    if (!hasObjectValue(next)) return {};

    return getLabeledAncestor({ node: next, name });
};

const isLoopBreak = ({ node = {}, rootNode = {}, switchDepth = 0 } = {}) => {
    const {
        label = {},
        parent = {}
    } = node;
    const { name: labelName = '' } = getObject(label);

    if (!labelName) return switchDepth === 0;

    const ancestor = getLabeledAncestor({ node: parent, name: labelName });
    const { type: ancestorType = '' } = getObject(ancestor);

    return Boolean(ancestorType) && isAncestor({ ancestor, node: rootNode });
};

const hasAwaitExpression = (node = {}, seen = new Set(), root = true) => {
    if (!isObject(node) || seen.has(node)) return false;

    const { type = '', ...properties } = node;

    if (type === 'AwaitExpression') return true;

    // Await in a callback does not make the surrounding collection loop sequential.
    if (!root && isFunctionType(type)) return false;

    const nextSeen = extendTraversalPath(seen, node);

    return someTraversalChild(properties, child => hasAwaitExpression(child, nextSeen, false));
};

const hasLoopControl = (
    node = {},
    seen = new Set(),
    root = true,
    switchDepth = 0,
    rootNode = node
) => {
    if (!isObject(node) || seen.has(node)) return false;

    const { type = '', ...properties } = node;

    if (!root && LOOP_TYPES.includes(type)) return false;

    if (!root && isFunctionType(type)) return false;

    if (type === 'BreakStatement') {
        return isLoopBreak({ node, rootNode, switchDepth });
    }

    if (LOOP_CONTROL_TYPES.includes(type)) return true;

    const nextSeen = extendTraversalPath(seen, node);
    const nextSwitchDepth = switchDepth + (type === 'SwitchStatement' ? 1 : 0);

    return someTraversalChild(properties, child => hasLoopControl(child, nextSeen, false, nextSwitchDepth, rootNode));
};

export {
    LOOP_TYPES,
    hasAwaitExpression,
    hasLoopControl
};
