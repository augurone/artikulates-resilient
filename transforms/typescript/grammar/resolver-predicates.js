// Render only after Policy has chosen the predicate and its helper requirements.
const renderResolverPredicate = ({ predicate = {}, standard = {}, bindMembers = false } = {}) => {
    const { kind = '', family = '', property = '', value = '', name = '' } = predicate;
    const { array = false, function: functionStandard = false, object = false } = standard;
    const propertyText = JSON.stringify(property);
    const member = bindMembers && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)
        ? `input_${property}` : `input[${propertyText}]`;

    if (kind === 'discriminant') return object
        ? `modelCheck(${propertyText}, input) && ${member} === ${JSON.stringify(value)}`
        : `isObject(input) && ${member} === ${JSON.stringify(value)}`;

    if (kind === 'property') return object
        ? `modelCheck(${propertyText}, input)`
        : `isObject(input) && ${propertyText} in input`;

    if (kind === 'literal') return `input === ${JSON.stringify(value)}`;

    if (kind === 'instance') return `input instanceof ${name}`;

    if (kind !== 'family') return '';

    if (family === 'object') return 'hasContent(input)';

    if (family === 'array') return array ? 'hasArrayContent(input)' : 'Array.isArray(input) && input.length';

    if (family === 'function' && functionStandard) return 'isFunction(input)';

    return `typeof input === '${family}'`;
};

export { renderResolverPredicate };
