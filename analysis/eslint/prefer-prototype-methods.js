import { LOOP_TYPES } from './support/loop-analysis.js';
import { createReporter } from './support/reporter.js';

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Prefer collection prototype methods over imperative loops',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-prototype-methods.md'
        },
        schema: [],
        messages: {
            prototypeMethod: 'Prefer a collection prototype method such as map, filter, reduce, some, find, or forEach over an imperative loop.'
        }
    },
    create(context = {}) {
        const report = createReporter(context);
        const reportLoop = node => report({ node, messageId: 'prototypeMethod' });

        return Object.fromEntries(LOOP_TYPES.map(loopType => [loopType, reportLoop]));
    }
};
