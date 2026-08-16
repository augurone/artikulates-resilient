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

const reportLoop = ({ report = () => {}, node = {} } = {}) => {
    report({
        node,
        messageId: 'prototypeMethod'
    });
};

const hasAwaitExpression = (node = {}, seen = new Set(), root = true) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    const { type = '', ...properties } = node;
    if (type === 'AwaitExpression') return true;
    // Await in a callback does not make the surrounding collection loop sequential.
    if (!root && FUNCTION_TYPES.includes(type)) return false;

    seen.add(node);

    return Object.entries(properties)
        .filter(([key = '']) => !['parent', 'loc', 'range', 'tokens', 'comments'].includes(key))
        .some(([, value = {}]) => Array.isArray(value)
            ? value.some(child => hasAwaitExpression(child, seen, false))
            : hasAwaitExpression(value, seen, false));
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Prefer collection prototype methods over imperative loops',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-prototype-methods.md'
        },
        schema: [],
        messages: {
            prototypeMethod: 'Prefer a collection prototype method such as map, filter, reduce, some, find, or forEach over an imperative loop.'
        }
    },
    create({ report = () => {} } = {}) {
        return LOOP_TYPES.reduce((visitors = {}, loopType = '') => ({
            ...visitors,
            [loopType]: (node = {}) => {
                if (hasAwaitExpression(node)) return;
                reportLoop({ report, node });
            }
        }), {});
    }
};
