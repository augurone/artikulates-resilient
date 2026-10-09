import { createPromiseChains } from '../promise-chains.js';

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Prefer async and await over ordinary promise then chains',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-async-await.md'
        },
        schema: [],
        messages: {
            asyncAwait: 'Prefer async and await over a promise then chain; add an explicit exception when the chain is required by the API or contract.'
        }
    },
    create(context = {}) {
        const chains = createPromiseChains(({ parent = false } = {}) => parent);

        return {
            MemberExpression(node) {
                if (!chains.calledThen(node) || chains.unhandled(node)) return;

                context.report({ node, messageId: 'asyncAwait' });
            }
        };
    }
};
