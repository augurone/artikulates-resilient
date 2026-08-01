const FUNCTION_TYPES = [
    'ArrowFunctionExpression',
    'FunctionDeclaration',
    'FunctionExpression'
];

const hasNestedIfAncestor = ({ node = {} } = {}) => {
    const { parent: ancestor = {} } = node;

    if (!ancestor) return false;
    if (ancestor.type === 'IfStatement') return true;
    if (FUNCTION_TYPES.includes(ancestor.type)) return false;
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
