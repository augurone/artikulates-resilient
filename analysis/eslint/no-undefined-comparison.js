import { createNativeUndefinedReader } from './support/native-absence.js';
import { createReporter } from './support/reporter.js';

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
        argument: { type: argumentType = '' } = {}
    } = node ?? {};

    return type === 'UnaryExpression' && operator === 'typeof' && argumentType !== '';
};

const isUndefinedTypeofTest = ({ left = {}, right = {} } = {}) => (
    (isUndefinedTypeof(left) && isUndefinedLiteral(right)) ||
    (isUndefinedTypeof(right) && isUndefinedLiteral(left))
);

const isUndefinedTest = ({ left = {}, right = {} } = {}, isNativeUndefined) => (
    isNativeUndefined(left) ||
    isNativeUndefined(right) ||
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
            undefinedComparison: 'Use !value or !!value only when all falsey values have the same consequence; '
                + 'otherwise preserve exact absence with a justified local resilient/no-undefined-comparison exception.'
        }
    },
    create(context = {}) {
        const { sourceCode = {} } = context;
        const report = createReporter(context);
        const isNativeUndefined = createNativeUndefinedReader({ sourceCode });

        return {
            BinaryExpression(node = {}) {
                const { operator = '' } = node;

                if (!['===', '!==', '==', '!='].includes(operator)) return;

                if (!isUndefinedTest(node, isNativeUndefined)) return;

                report({
                    node,
                    messageId: 'undefinedComparison'
                });
            }
        };
    }
};
