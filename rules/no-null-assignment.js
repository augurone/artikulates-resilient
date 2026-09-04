import { getObject, isObject } from './support/object.js';

const isNullLiteral = (node = {}) => {
    const {
        type = '',
        value = {}
    } = getObject(node);

    return type === 'Literal' && value === null;
};

const getNullLiteral = ({ node = {} } = {}) => {
    if (!isObject(node)) return {};

    if (isNullLiteral(node)) return node;

    const {
        type = '',
        consequent = {},
        alternate = {},
        left = {},
        right = {},
        expressions = [],
        properties = [],
        elements = [],
        value = {}
    } = getObject(node);
    const childNodesByType = {
        ConditionalExpression: [consequent, alternate],
        LogicalExpression: [left, right],
        AssignmentExpression: [left, right],
        SequenceExpression: expressions,
        ObjectExpression: properties,
        ArrayExpression: elements,
        Property: [value]
    };
    const { [type]: childNodes = [] } = childNodesByType;
    const matches = childNodes
        .map(child => getNullLiteral({ node: getObject(child) }))
        .filter(({ type: childType = '' } = {}) => childType);
    const [firstMatch = {}] = matches;

    return firstMatch;
};

const reportNullAssignment = ({ node = {}, report } = {}) => {
    const nullNode = getNullLiteral({ node });
    const { type: nullType = '' } = getObject(nullNode);

    if (!nullType) return;

    if (typeof report !== 'function') return;

    report({
        node: nullNode,
        messageId: 'nullAssignment'
    });
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow explicitly assigning null',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-null-assignment.md'
        },
        schema: [],
        messages: {
            nullAssignment: `Do not assign null; respect contracts, set defaults '', {}, [], 0, false, or do not set`
        }
    },
    create({ report = () => {} } = {}) {
        return {
            VariableDeclarator({ init = {} } = {}) {
                reportNullAssignment({
                    node: init,
                    report
                });
            },
            AssignmentExpression({ right = {} } = {}) {
                reportNullAssignment({
                    node: right,
                    report
                });
            }
        };
    }
};
