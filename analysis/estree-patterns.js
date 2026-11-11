// Binding and assignment target edges exclude computed keys and default values.
export const patternChildren = ({ type = '', left = false, argument = false, properties = [], elements = [], value = false } = {}) => {
    if (type === 'AssignmentPattern') return [left];

    if (type === 'RestElement') return [argument];

    if (type === 'ObjectPattern') return properties;

    if (type === 'ArrayPattern') return elements.filter(Boolean);

    if (type === 'Property') return [value];

    return [];
};
