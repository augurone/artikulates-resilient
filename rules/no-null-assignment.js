const isNullLiteral = (node = {}) => {
    const {
        type = '',
        value = {}
    } = node ?? {};

    return type === 'Literal' && value === null;
};

const reportNullAssignment = ({ node = {}, report = () => {} } = {}) => {
    const safeNode = node ?? {};
    if (!isNullLiteral(safeNode)) return;

    report({
        node: safeNode,
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
