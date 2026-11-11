import { getObject } from './object.js';

const functionTypes = new Set([
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'FunctionExpression'
]);

const getEnclosingFunction = (node = {}) => {
    const { parent = {} } = getObject(node);
    const { type = '' } = getObject(parent);

    if (!type) return {};

    if (functionTypes.has(type)) return parent;

    return getEnclosingFunction(parent);
};

export { getEnclosingFunction };
