import { getObject, hasObjectValue } from './object.js';

const getNodeParents = ({ node = {}, parents = [] } = {}) => {
    const { parent = {} } = getObject(node);

    if (!hasObjectValue(parent)) return parents;

    const result = [...parents, parent];
    const appendParents = (source = {}) => {
        const { parent: nextParent = {} } = getObject(source);

        if (!hasObjectValue(nextParent)) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- This private parent buffer appends exact AST identities without copying the growing prefix or mutating the seed or nodes.
        result.push(nextParent);
        appendParents(nextParent);
    };
    appendParents(parent);

    return result;
};

export { getNodeParents };
