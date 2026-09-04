const isUndefinedIdentifier = (node = {}) => {
    const {
        type = '',
        name = ''
    } = node ?? {};

    return (
        type === 'Identifier' && name === 'undefined'
    );
};

const reportUndefinedAssignment = ({ node = {}, report } = {}) => {
    const safeNode = node ?? {};

    if (!isUndefinedIdentifier(safeNode)) return;

    if (typeof report !== 'function') return;

    report({
        node: safeNode,
        messageId: 'undefinedAssignment'
    });
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow explicitly assigning undefined',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-undefined-assignment.md'
        },
        schema: [],
        messages: {
            undefinedAssignment: `Do not assign undefined, it is a state not a value. Respect contracts, set defaults '', {}, [], 0, false, or do not set`
        }
    },
    create({ report = () => {} } = {}) {
        return {
            VariableDeclarator({ init = {} } = {}) {
                reportUndefinedAssignment({
                    node: init,
                    report
                });
            },
            AssignmentExpression({ right = {} } = {}) {
                reportUndefinedAssignment({
                    node: right,
                    report
                });
            }
        };
    }
};
