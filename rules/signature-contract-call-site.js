import { getEslintContractDiagnostics } from './contracts/eslint-graph.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Report known call-site values that contradict a function signature contract',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-call-site.md'
        },
        schema: [],
        messages: {
            mismatch: '{{path}} expects {{expected}}, but this call supplies {{actual}}.'
        }
    },
    create(context = {}) {
        const { report = () => {} } = context;
        return {
            Program(node = {}) {
                getEslintContractDiagnostics({
                    context,
                    program: node,
                    ruleId: 'signature-contract-call-site'
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
