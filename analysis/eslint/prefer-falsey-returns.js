import { traverse } from '../traversal.js';
import { createNativeUndefinedReader, isNullLiteral } from './support/native-absence.js';
import { isObject } from './support/object.js';
import { createReporter } from './support/reporter.js';

const returnChildren = ({
    type = '',
    left = {},
    right = {},
    consequent = {},
    alternate = {},
    expressions = [],
    operator = '',
    argument = {}
} = {}) => {
    if (type === 'ConditionalExpression') {
        return [consequent, alternate];
    }

    // OR and nullish coalescing cannot return a nullish left operand. Ordinary
    // assignment returns its RHS; arithmetic assignment returns the operation's
    // result, not either operand. These are syntax semantics, not value inference.
    if (type === 'LogicalExpression') return operator === '&&' ? [left, right] : [right];

    if (type === 'AssignmentExpression' && operator === '&&=') return [left, right];

    if (type === 'AssignmentExpression' && ['=', '||=', '??='].includes(operator)) return [right];

    if (type === 'SequenceExpression') return [expressions.at(-1)];

    if (type === 'AwaitExpression') return [argument];

    return [];
};

const reportFalseyNodes = (node, report, isNativeUndefined) => traverse(node, {
    enter: (candidate = {}) => {
        if (!isObject(candidate)) return [];

        const { type = '', operator = '' } = candidate;

        if (isNullLiteral(candidate) || (type === 'UnaryExpression' && operator === 'void') || isNativeUndefined(candidate)) {
            report({ node: candidate, messageId: 'falseyReturn' });

            return [];
        }

        return returnChildren(candidate);
    }
});

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Prefer explicit falsey return values while allowing bare returns',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-falsey-returns.md'
        },
        schema: [],
        messages: {
            falseyReturn: 'Return the expected empty type instead of null or undefined: {}, [], "", 0, or false.'
        }
    },
    create(context = {}) {
        const { sourceCode = {} } = context;
        const isNativeUndefined = createNativeUndefinedReader({ sourceCode });
        const report = createReporter(context);

        return {
            ReturnStatement({ argument = {} } = {}) {
                reportFalseyNodes(argument, report, isNativeUndefined);
            },
            ArrowFunctionExpression({ body = {} } = {}) {
                const { type: bodyType = '' } = body;

                if (bodyType === 'BlockStatement') return;

                reportFalseyNodes(body, report, isNativeUndefined);
            }
        };
    }
};
