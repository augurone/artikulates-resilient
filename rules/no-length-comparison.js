const isLengthMember = ({
    type = '',
    computed = false,
    property: {
        type: propertyType = '',
        name: propertyName = ''
    } = {}
} = {}) => (
    type === 'MemberExpression' &&
    !computed &&
    propertyType === 'Identifier' &&
    propertyName === 'length'
);

const isZeroLiteral = ({ type = '', value = 0 } = {}) => (
    type === 'Literal' && value === 0
);

const isLengthPresenceComparison = ({
    operator = '',
    left = {},
    right = {}
} = {}) => (
    (['===', '!==', '>'].includes(operator) &&
        isLengthMember(left) && isZeroLiteral(right)) ||
    (['===', '!==', '<'].includes(operator) &&
        isZeroLiteral(left) && isLengthMember(right))
);

const getLengthNode = ({ left = {}, right = {} } = {}) => (
    isLengthMember(left) ? left : right
);

const getSourceText = ({ sourceCode = {}, node = {} } = {}) => {
    const { getText = false } = sourceCode;

    if (typeof getText !== 'function') return '';

    return getText.call(sourceCode, node);
};

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Disallow length presence comparisons in favor of length truthiness',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-length-comparison.md'
        },
        schema: [],
        hasSuggestions: true,
        messages: {
            lengthComparison: 'Use !collection.length or collection.length for a zero/non-zero check. Preserve exact cardinality comparisons such as length === [1...].',
            replaceWithFalseyCheck: 'Replace the zero-length comparison with !collection.length.',
            replaceWithLength: 'Replace the non-zero comparison with collection.length.'
        }
    },
    create({ report = () => {}, sourceCode = {} } = {}) {
        return {
            BinaryExpression(node = {}) {
                if (!isLengthPresenceComparison(node)) return;

                const lengthNode = getLengthNode(node);
                const lengthText = getSourceText({ sourceCode, node: lengthNode });
                const { operator = '', left = {} } = node;
                const isNonZeroCheck = ['!==', '>'].includes(operator) || (
                    operator === '<' && isZeroLiteral(left)
                );

                report({
                    node,
                    messageId: 'lengthComparison',
                    suggest: [{
                        messageId: isNonZeroCheck
                            ? 'replaceWithLength'
                            : 'replaceWithFalseyCheck',
                        fix: fixer => fixer.replaceText(
                            node,
                            isNonZeroCheck ? lengthText : `!${lengthText}`
                        )
                    }]
                });
            }
        };
    }
};
