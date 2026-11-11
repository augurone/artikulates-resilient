// Binding and assignment target edges exclude computed keys and default values.
export const patternChildren = ({ type = '', left = false, argument = false, properties = [], elements = [], value = false } = {}) => {
    if (type === 'AssignmentPattern') return [left];

    if (type === 'RestElement') return [argument];

    if (type === 'ObjectPattern') return properties;

    if (type === 'ArrayPattern') return elements.filter(Boolean);

    if (type === 'Property') return [value];

    return [];
};

export const mutationTarget = (node, { type = '', left = false, argument = false } = {}, operator = '') => (
    (['AssignmentExpression', 'ForOfStatement', 'ForInStatement'].includes(type) && left === node) ||
    (type === 'UpdateExpression' && argument === node) || (type === 'UnaryExpression' && operator === 'delete' && argument === node)
);

// Member leaves are permitted in assignment patterns, never binding patterns.
// Receiver objects, computed keys and default expressions remain reads.
export const memberTarget = ({ node = {}, parent = {}, grandparent = {} } = {}) => {
    const { type = '', left = false, argument = false, value = false } = parent;
    const { type: ancestorType = '' } = grandparent;
    const wrapped = type === 'ChainExpression';
    const owner = wrapped ? grandparent : parent;
    const { operator = '' } = owner;

    return mutationTarget(wrapped ? parent : node, owner, operator) || type === 'ArrayPattern' ||
        (type === 'Property' && value === node && ancestorType === 'ObjectPattern') ||
        (type === 'AssignmentPattern' && left === node) || (type === 'RestElement' && argument === node);
};
