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

const isZeroLengthEquality = ({
    operator = '',
    left = {},
    right = {}
} = {}) => (
    operator === '===' && (
        (isLengthMember(left) && isZeroLiteral(right)) ||
        (isZeroLiteral(left) && isLengthMember(right))
    )
);

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Disallow length === 0 in favor of !length',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-length-comparison.md'
        },
        schema: [],
        messages: {
            lengthComparison: 'Use !collection.length for a zero-length check. Preserve exact cardinality comparisons such as length === N[1...].'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            BinaryExpression(node = {}) {
                if (!isZeroLengthEquality(node)) return;
                report({
                    node,
                    messageId: 'lengthComparison'
                });
            }
        };
    }
};
