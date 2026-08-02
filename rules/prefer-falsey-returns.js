const isFalseyNode = ({ argument = {} } = {}) => {
    const {
        type = '',
        name = '',
        value = {}
    } = argument;

    return (
        (type === 'Identifier' && name === 'undefined') ||
        (type === 'Literal' && value === null)
    );
};

const getFalseyNodes = (node = {}) => {
    if (!node || typeof node !== 'object') return [];
    if (isFalseyNode({ argument: node })) return [node];

    const {
        type = '',
        left = {},
        right = {},
        consequent = {},
        alternate = {},
        expressions = [],
        operator = '',
        argument = {}
    } = node;

    if (type === 'ConditionalExpression') {
        return [
            ...getFalseyNodes(consequent),
            ...getFalseyNodes(alternate)
        ];
    }

    if (type === 'LogicalExpression' || type === 'AssignmentExpression') {
        return [
            ...getFalseyNodes(left),
            ...getFalseyNodes(right)
        ];
    }

    if (type === 'SequenceExpression') {
        return getFalseyNodes(expressions.at(-1));
    }

    if (type === 'AwaitExpression') return getFalseyNodes(argument);
    if (type === 'UnaryExpression' && operator === 'void') return [node];

    return [];
};

const reportFalseyNodes = ({ node = {}, report = () => {} } = {}) => {
    getFalseyNodes(node).forEach((falseyNode = {}) => {
        report({
            node: falseyNode,
            messageId: 'falseyReturn'
        });
    });
};

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
    create({ report = () => {} } = {}) {
        return {
            ReturnStatement({ argument = {} } = {}) {
                reportFalseyNodes({ node: argument, report });
            },
            ArrowFunctionExpression({ body = {} } = {}) {
                if (body.type === 'BlockStatement') return;
                reportFalseyNodes({ node: body, report });
            }
        };
    }
};
