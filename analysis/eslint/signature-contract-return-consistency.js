import { createAnalysisListener } from './support/analysis.js';

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Report known producer returns with incompatible value families',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/signature-contract-return-consistency.md' },
        schema: [],
        messages: {
            inconsistent: 'This function returns {{actual}}, but another return path produces {{expected}}.',
            inconsistentOperand: 'This {{operator}} expression returns its {{actual}} operand, but another return path produces {{expected}}.',
            inconsistentValue: 'This returned value can be {{actual}} or {{expected}}; every return path must produce one value family.'
        }
    },
    create(context = {}) {
        return createAnalysisListener(context, (analysis, report) => {
            const { functions = [] } = analysis;

            functions.forEach(({ index = -1 } = {}) => {
                const { diagnostics = [] } = analysis.checkFunction({ index });

                diagnostics.forEach(({ messageId = '', data = {}, location = {} } = {}) => report({
                    location, messageId, data
                }));
            });
        });
    }
};
