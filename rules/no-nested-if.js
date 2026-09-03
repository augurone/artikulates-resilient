const FUNCTION_TYPES = [
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'FunctionExpression'
];

const hasNestedIfAncestor = ({ node: { parent: ancestor = {} } = {} } = {}) => {
    if (!ancestor) return false;

    const { type: ancestorType = '' } = ancestor;

    if (ancestorType === 'IfStatement') return true;

    if (FUNCTION_TYPES.includes(ancestorType)) return false;

    return hasNestedIfAncestor({ node: ancestor });
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow nested if statements',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-nested-if.md'
        },
        schema: [],
        messages: {
            nestedIf: 'Flatten nested if statements with guard clauses and early returns.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            IfStatement(node = {}) {
                if (!hasNestedIfAncestor({ node })) return;

                report({
                    node,
                    messageId: 'nestedIf'
                });
            }
        };
    }
};
