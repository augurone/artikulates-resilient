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

const FUNCTION_TYPES = [
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'FunctionExpression'
];

const LOOP_CONTROL_TYPES = [
    'BreakStatement',
    'ContinueStatement',
    'ReturnStatement',
    'ThrowStatement'
];

const isAncestor = ({ ancestor = {}, node = {} } = {}) => {
    let current = node;

    while (hasObjectValue(current)) {
        if (current === ancestor) return true;

        const { parent = {} } = current;
        current = parent;
    }

    return false;
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
    if (!root && FUNCTION_TYPES.includes(type)) return false;

    const nextSeen = new Set([...seen, node]);

    return Object.entries(properties)
        .filter(([key = '']) => !['parent', 'loc', 'range', 'tokens', 'comments'].includes(key))
        .some(([, value = {}]) => Array.isArray(value)
            ? value.some(child => hasAwaitExpression(child, nextSeen, false))
            : hasAwaitExpression(value, nextSeen, false));
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

    if (!root && FUNCTION_TYPES.includes(type)) return false;

    if (type === 'BreakStatement') {
        return isLoopBreak({ node, rootNode, switchDepth });
    }

    if (LOOP_CONTROL_TYPES.includes(type)) return true;

    const nextSeen = new Set([...seen, node]);
    const nextSwitchDepth = switchDepth + (type === 'SwitchStatement' ? 1 : 0);

    return Object.entries(properties)
        .filter(([key = '']) => !['parent', 'loc', 'range', 'tokens', 'comments'].includes(key))
        .some(([, value = {}]) => Array.isArray(value)
            ? value.some(child => hasLoopControl(child, nextSeen, false, nextSwitchDepth, rootNode))
            : hasLoopControl(value, nextSeen, false, nextSwitchDepth, rootNode));
};

const hasAllowComment = ({ sourceCode = {}, node = {} } = {}) => {
    const { getCommentsBefore = false } = sourceCode;

    if (typeof getCommentsBefore !== 'function') return false;

    return getCommentsBefore.call(sourceCode, node)
        .some(({ value = '' } = {}) => /^\s*resilient-allow-loop\s*:\s*\S/.test(value));
};

const hasLoopException = ({ sourceCode = {}, node = {} } = {}) => (
    hasAwaitExpression(node) ||
    hasLoopControl(node) ||
    hasAllowComment({ sourceCode, node })
);

const getEnclosingLoop = ({ node = {} } = {}) => {
    const { parent = {} } = getObject(node);
    const { type: parentType = '' } = getObject(parent);

    if (!hasObjectValue(parent) || !parentType) return {};

    if (LOOP_TYPES.includes(parentType)) return parent;

    if (FUNCTION_TYPES.includes(parentType)) return {};

    return getEnclosingLoop({ node: parent });
};

const isCoveredByLoopRule = ({ sourceCode = {}, node = {} } = {}) => {
    const loop = getEnclosingLoop({ node });
    const { type: loopType = '' } = loop;

    return Boolean(loopType) && !hasLoopException({ sourceCode, node: loop });
};

export {
    LOOP_TYPES,
    hasAllowComment,
    hasAwaitExpression,
    hasLoopControl,
    isCoveredByLoopRule
};
