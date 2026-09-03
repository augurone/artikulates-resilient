import { getEslintContractDiagnostics } from './contracts/eslint-graph.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Report known value shapes and missing properties in destructuring patterns',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-destructuring.md'
        },
        schema: [],
        messages: {
            mismatch: 'This {{actual}} value is destructured as {{expected}}.',
            missingProperty: 'Property {{property}} does not exist on this known object contract.'
        }
    },
    create(context = {}) {
        const { report = () => {} } = context;
        return {
            Program(node = {}) {
                getEslintContractDiagnostics({
                    context,
                    program: node,
                    ruleId: 'signature-contract-destructuring'
                }).forEach(({
                    data = {},
                    messageId = 'mismatch',
                    node: reportNode = {}
                } = {}) => {
                    report({
                        node: reportNode,
                        messageId,
                        data
                    });
                });
            }
        };
    }
};
