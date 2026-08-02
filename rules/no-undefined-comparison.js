const isUndefinedIdentifier = (node = {}) => {
    const {
        type = '',
        name = ''
    } = node ?? {};

    return type === 'Identifier' && name === 'undefined';
};

const isUndefinedLiteral = (node = {}) => {
    const {
        type = '',
        value = {}
    } = node ?? {};

    return type === 'Literal' && value === 'undefined';
};

const isUndefinedTypeof = (node = {}) => {
    const {
        type = '',
        operator = '',
        argument = {}
    } = node ?? {};

    return type === 'UnaryExpression' && operator === 'typeof' && argument.type !== '';
};

const isUndefinedTypeofTest = ({ left = {}, right = {} } = {}) => (
    (isUndefinedTypeof(left) && isUndefinedLiteral(right)) ||
    (isUndefinedTypeof(right) && isUndefinedLiteral(left))
);

const isUndefinedTest = ({ left = {}, right = {} } = {}) => (
    isUndefinedIdentifier(left) ||
    isUndefinedIdentifier(right) ||
    isUndefinedTypeofTest({ left, right })
);

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow explicit undefined comparisons',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-undefined-comparison.md'
        },
        schema: [],
        messages: {
            undefinedComparison: 'Use !value or !!value instead of testing undefined explicitly.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            BinaryExpression(node = {}) {
                const { operator = '' } = node;
                if (!['===', '!==', '==', '!='].includes(operator)) return;
                if (!isUndefinedTest(node)) return;

                report({
                    node,
                    messageId: 'undefinedComparison'
                });
            }
        };
    }
};
