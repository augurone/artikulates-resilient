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

const isCountLiteral = ({ type = '', value = false } = {}, expected) => (
    type === 'Literal' && value === expected
);

const isLengthPresenceComparison = ({
    operator = '',
    left = {},
    right = {}
} = {}) => (
    (['===', '!==', '>', '<='].includes(operator) && isLengthMember(left) && isCountLiteral(right, 0)) ||
    (['>=', '<'].includes(operator) && isLengthMember(left) && isCountLiteral(right, 1)) ||
    (['===', '!==', '<', '>='].includes(operator) && isCountLiteral(left, 0) && isLengthMember(right)) ||
    (['<=', '>'].includes(operator) && isCountLiteral(left, 1) && isLengthMember(right))
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
            lengthComparison: 'Use !collection.length or !!collection.length for a zero/non-zero check. Preserve exact cardinality comparisons such as length === 1.'
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
