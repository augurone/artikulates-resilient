const isUndefinedIdentifier = ({ type = '', name = '' } = {}) => (
    type === 'Identifier' && name === 'undefined'
);

const reportUndefinedAssignment = ({ node = {}, report = () => {} } = {}) => {
    if (!isUndefinedIdentifier(node)) return;

    report({
        node,
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
            undefinedAssignment: 'Do not assign undefined. Normalize flexible data before returning a value.'
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
