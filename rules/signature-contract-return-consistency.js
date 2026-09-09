import { getLocalAnalysisSession } from './contracts/analysis-session.js';
import { getReturnDiagnostics } from './contracts/diagnostics.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Report known functions that return incompatible value families',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-return-consistency.md'
        },
        schema: [],
        messages: {
            inconsistent: 'This function returns {{actual}}, but another return path produces {{expected}}.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            Program(node = {}) {
                const {
                    definitions = {},
                    getFlows = undefined,
                    getFunctions = undefined
                } = getLocalAnalysisSession(node);
                const flows = getFlows();

                getReturnDiagnostics({
                    program: node,
                    definitions,
                    flows,
                    functions: getFunctions(),
                    analysis: {
                        definitions,
                        getFlows: () => flows
                    }
                }).forEach(({
                    data = {},
                    node: reportNode = {}
                } = {}) => report({
                    node: reportNode,
                    messageId: 'inconsistent',
                    data
                }));
            }
        };
    }
};
