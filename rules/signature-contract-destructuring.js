import { getDestructuringDiagnostics } from './contracts/diagnostics.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Report known value shapes that contradict a destructuring pattern',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-destructuring.md'
        },
        schema: [],
        messages: {
            mismatch: 'This {{actual}} value is destructured as {{expected}}.'
        }
    },
    create({ report = () => {} } = {}) {
        return {
            Program(node = {}) {
                getDestructuringDiagnostics({ program: node }).forEach(({
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
