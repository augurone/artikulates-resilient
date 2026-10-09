import { traverse } from '../traversal.js';
import { isNullLiteral } from './support/native-absence.js';
import { isObject } from './support/object.js';
import { createReporter } from './support/reporter.js';

const getNullChildren = ({
    type = '',
    consequent = {},
    alternate = {},
    left = {},
    right = {},
    expressions = [],
    properties = [],
    elements = [],
    value = {}
} = {}) => {
    if (type === 'ConditionalExpression') return [consequent, alternate];

    if (type === 'LogicalExpression' || type === 'AssignmentExpression') return [left, right];

    if (type === 'SequenceExpression') return expressions;

    if (type === 'ObjectExpression') return properties;

    if (type === 'ArrayExpression') return elements;

    return type === 'Property' ? [value] : [];
};

const getNullLiteral = (node) => {
    let nullNode = false;

    traverse(node, { enter: (candidate = {}) => {
        if (nullNode || !isObject(candidate)) return [];

        if (isNullLiteral(candidate)) {
            nullNode = candidate;

            return [];
        }

        return getNullChildren(candidate);
    } });

    return nullNode;
};

const reportNullAssignment = (node, report) => {
    const nullNode = getNullLiteral(node);

    if (!nullNode) return;

    report({
        node: nullNode,
        messageId: 'nullAssignment'
    });
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow explicitly assigning null, including null defaults',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-null-assignment.md'
        },
        schema: [],
        messages: {
            nullAssignment: `Do not assign null; respect contracts, set defaults '', {}, [], 0, false, or do not set`
        }
    },
    create(context = {}) {
        const report = createReporter(context);

        return {
            VariableDeclarator({ init = {} } = {}) {
                reportNullAssignment(init, report);
            },
            AssignmentExpression({ right = {} } = {}) {
                reportNullAssignment(right, report);
            },
            // A default is an assignment: parameters, object and array patterns.
            AssignmentPattern({ right = {} } = {}) {
                reportNullAssignment(right, report);
            }
        };
    }
};
