const FUNCTION_TYPES = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression'
]);

const isFunctionNode = ({ type = '' } = {}) => FUNCTION_TYPES.has(type);

const isFunction = value => typeof value === 'function';

export {
    FUNCTION_TYPES,
    isFunction,
    isFunctionNode
};
