import { getEslintContractDiagnostics } from './contracts/eslint-graph.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Report native operations that contradict an inferred value contract',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-operation.md'
        },
        schema: [],
        messages: {
            mismatch: '{{receiver}} is {{actual}}, but .{{method}}() requires a {{expected}}.'
        }
    },
    create(context = {}) {
        const { report = () => {} } = context;
        return {
            Program(node = {}) {
                getEslintContractDiagnostics({
                    context,
                    program: node,
                    ruleId: 'signature-contract-operation'
                }).forEach(({
                    data = {},
                    node: reportNode = {}
                } = {}) => {
                    report({
                        node: reportNode,
                        messageId: 'mismatch',
                        data
                    });
                });
            }
        };
    }
};
