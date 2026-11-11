import { createAnalysisListener } from './support/analysis.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Require known promise work to handle or propagate rejection',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-unhandled-promise-chain.md'
        },
        schema: [],
        messages: { unhandled: 'Handle or explicitly propagate this promise chain rejection; add catch, await, return, or void for intentional fire-and-forget work.' }
    },
    create(context = {}) {
        return createAnalysisListener(context, (analysis, report) => {
            const { promiseUses = [] } = analysis;

            promiseUses.forEach(({ index = -1, location = {} } = {}) => {
                const { unhandled = false } = analysis.checkPromiseUse({ index });

                if (!unhandled) return;

                report({ location, messageId: 'unhandled' });
            });
        });
    }
};
