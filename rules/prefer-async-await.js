const isThenMember = ({
    type = '',
    computed = false,
    property: {
        type: propertyType = '',
        name = ''
    } = {}
} = {}) => (
    type === 'MemberExpression' &&
    !computed &&
    propertyType === 'Identifier' &&
    name === 'then'
);

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

const getOuterChain = (node = {}) => {
    const { parent = {} } = node;
    const {
        type: parentType = '',
        callee = {},
        object = {}
    } = parent;

    if (parentType === 'CallExpression' && callee === node) return getOuterChain(parent);

    if (parentType === 'MemberExpression' && object === node) return getOuterChain(parent);

    return node;
};

const isUnhandledExpression = ({ node = {} } = {}) => {
    const outer = getOuterChain(node);
    const { parent: { type: parentType = '' } = {} } = outer;
    const methods = getChainMethods(outer);

    return (
        parentType === 'ExpressionStatement' &&
        methods.some(method => ['then', 'finally'].includes(method)) &&
        !methods.includes('catch')
    );
};

const hasAllowComment = ({ sourceCode = {}, node = {} } = {}) => {
    const { getCommentsBefore = false } = sourceCode;

    if (typeof getCommentsBefore !== 'function') return false;

    return getCommentsBefore.call(sourceCode, node)
        .some(({ value = '' } = {}) => /^\s*resilient-allow-promise-chain\s*:\s*\S/.test(value));
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Prefer async and await over ordinary promise then chains',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-async-await.md'
        },
        schema: [],
        messages: {
            asyncAwait: 'Prefer async and await over a promise then chain; add an explicit exception when the chain is required by the API or contract.'
        }
    },
    create({ report = () => {}, sourceCode = {} } = {}) {
        return {
            MemberExpression(node = {}) {
                if (!isThenMember(node) || hasAllowComment({ sourceCode, node })) return;

                const {
                    parent: parentNode = {}
                } = node;
                const {
                    type: parentType = '',
                    callee = {}
                } = parentNode;

                if (parentType !== 'CallExpression' || callee !== node) return;

                if (isUnhandledExpression({ node: parentNode })) return;

                report({
                    node,
                    messageId: 'asyncAwait'
                });
            }
        };
    }
};
