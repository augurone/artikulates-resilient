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

    while (current && typeof current === 'object') {
        if (current === ancestor) return true;
        const { parent = {} } = current;
        current = parent;
    }

    return false;
};

const isLoopBreak = ({ node = {}, rootNode = {}, switchDepth = 0 } = {}) => {
    const { label = {} } = node;

    if (!label || !label.name) return switchDepth === 0;

    const { parent = {} } = node;
    let current = parent;
    while (current && typeof current === 'object') {
        if (
            current.type === 'LabeledStatement' &&
            current.label &&
            current.label.name === label.name
        ) return isAncestor({ ancestor: current, node: rootNode });

        const { parent: next = {} } = current;
        current = next;
    }

    return false;
};

const hasAwaitExpression = (node = {}, seen = new Set(), root = true) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
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
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
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
    if (typeof sourceCode.getCommentsBefore !== 'function') return false;

    return sourceCode.getCommentsBefore(node)
        .some(({ value = '' } = {}) => /^\s*resilient-allow-loop(?:\s*:|\s*$)/.test(value));
};

const hasLoopException = ({ sourceCode = {}, node = {} } = {}) => (
    hasAwaitExpression(node) ||
    hasLoopControl(node) ||
    hasAllowComment({ sourceCode, node })
);

const getEnclosingLoop = ({ node = {} } = {}) => {
    const { parent = {} } = node;
    if (!parent || !parent.type) return {};
    if (LOOP_TYPES.includes(parent.type)) return parent;
    if (FUNCTION_TYPES.includes(parent.type)) return {};
    return getEnclosingLoop({ node: parent });
};

const isCoveredByLoopRule = ({ sourceCode = {}, node = {} } = {}) => {
    const loop = getEnclosingLoop({ node });
    return Boolean(loop.type) && !hasLoopException({ sourceCode, node: loop });
};

export {
    LOOP_TYPES,
    hasAllowComment,
    hasAwaitExpression,
    hasLoopControl,
    isCoveredByLoopRule
};
