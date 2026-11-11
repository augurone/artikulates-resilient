import { getObject } from './object.js';

// Lexical resolution belongs to ESLint: the rule's own sourceCode owns the scope.
const getBinding = ({ sourceCode = {}, node = {} } = {}) => {
    const { type = '', name = '' } = getObject(node);

    if (type !== 'Identifier' || !name) return false;

    const find = (scope = {}) => {
        const { set = new Map(), upper = false } = getObject(scope);

        return set.get(name) || (upper && find(upper));
    };

    return find(sourceCode.getScope(node));
};

const getBindingDefinition = (binding) => {
    const { defs = [] } = getObject(binding);
    const [definition = {}] = defs;

    return defs.length === 1 ? definition : {};
};

export { getBinding, getBindingDefinition };
