const getStaticPropertyName = ({
    type = '',
    computed = false,
    property: {
        type: propertyType = '',
        name = ''
    } = {}
} = {}) => {
    if (type !== 'MemberExpression' || computed || propertyType !== 'Identifier') return '';

    return name;
};

const getChainMethods = ({ type = '', callee = {} } = {}) => {
    if (type !== 'CallExpression') return [];

    const method = getStaticPropertyName(callee);
    const { object = {} } = callee;

    return [
        ...(method ? [method] : []),
        ...getChainMethods(object)
    ];
};

export { getChainMethods, getStaticPropertyName };
