const hasMeaningfulStatement = ({ body = [] } = {}) => body
    .some(({ type = '' } = {}) => type !== 'EmptyStatement');

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow catch blocks that silently discard failures',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-silent-catch.md'
        },
        schema: [],
        messages: {
            silentCatch: 'Handle, translate, rethrow, or explicitly return from this catch block; do not silently discard the failure.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            CatchClause({ body = {} } = {}) {
                if (body.type !== 'BlockStatement' || hasMeaningfulStatement(body)) return;

                report({
                    node: body,
                    messageId: 'silentCatch'
                });
            }
        };
    }
};
