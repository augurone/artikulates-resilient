export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow else and else if branches',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-else.md'
        },
        schema: [],
        messages: {
            noElse: 'Remove else or else if. Use an early return and keep the main path unindented.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            IfStatement({ alternate = {} } = {}) {
                if (!alternate) return;

                report({
                    node: alternate,
                    messageId: 'noElse'
                });
            }
        };
    }
};
