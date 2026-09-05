import { getEslintContractDiagnostics } from './contracts/eslint-graph.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Report access to properties absent from a known closed object contract',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-property.md'
        },
        schema: [],
        messages: {
            missingProperty: 'Property {{property}} does not exist on this known object contract.',
            missingPropertyWithEvidence: 'Property {{property}} does not exist on this known object contract{{evidenceHint}}.'
        }
    },
    create(context = {}) {
        const { report = () => {} } = context;

        return {
            Program(node = {}) {
                getEslintContractDiagnostics({
                    context,
                    program: node,
                    ruleId: 'signature-contract-property'
                }).forEach(({
                    data = {},
                    messageId = 'missingProperty',
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
