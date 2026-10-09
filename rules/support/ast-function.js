const functionTypes = new Set([
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'FunctionExpression'
]);

const isFunctionType = (type = '') => functionTypes.has(type);

export { isFunctionType };
