const isObjectPattern = ({ type = '' } = {}) => type === 'ObjectPattern';

const isOrExpression = ({ type = '', operator = '' } = {}) => (
    type === 'LogicalExpression' && operator === '||'
);

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow logical OR as a fallback source for object destructuring',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-destructuring-fallback.md'
        },
        schema: [],
        messages: {
            destructuringFallback: 'Do not use || as a destructuring fallback. Default the object in the function signature or declaration.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            VariableDeclarator({ id = {}, init = {} } = {}) {
                if (!isObjectPattern(id) || !isOrExpression(init)) return;

                report({
                    node: init,
                    messageId: 'destructuringFallback'
                });
            }
        };
    }
};
