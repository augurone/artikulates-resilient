import { createReporter } from './support/reporter.js';

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

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Disallow length presence comparisons in favor of length truthiness',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-length-comparison.md'
        },
        schema: [],
        messages: {
            lengthComparison: 'Use !collection.length or !!collection.length for a zero/non-zero check. Preserve exact cardinality comparisons such as length === [1...].'
        }
    },
    create(context = {}) {
        const report = createReporter(context);

        return {
            BinaryExpression(node = {}) {
                if (!isLengthPresenceComparison(node)) return;

                // A property spelling cannot prove a native numeric length.
                // Keep the policy finding without choosing a runtime rewrite.
                report({ node, messageId: 'lengthComparison' });
            }
        };
    }
};
