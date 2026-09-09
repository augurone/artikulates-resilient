import { createCallableEvidence } from './contracts/callable-evidence.js';
import { getObject } from './support/object.js';

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Require guards before invoking optional destructured callbacks',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-unguarded-callback-invocation.md'
        },
        schema: [],
        messages: {
            unguarded: 'Guard optional callback {{name}} with isFunction(...) or a typeof function check before invoking it.'
        }
    },
    create(context = {}) {
        const { report = () => {} } = context;
        const { getOptionalCallback = undefined, hasCapability = undefined } = createCallableEvidence(context);

        return {
            CallExpression(node = {}) {
                const { callee = {} } = node;
                const { type = '', name = '' } = getObject(callee);

                if (type !== 'Identifier') return;

                if (!name || !getOptionalCallback(callee) ||
                    hasCapability(node, callee)) return;

                report({ node, messageId: 'unguarded', data: { name } });
            }
        };
    }
};
