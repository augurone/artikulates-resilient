import { getLocalAnalysisSession } from './contracts/analysis-session.js';
import { inferExpression } from './contracts/infer.js';
import { getChainMethods } from './support/member-chain.js';

const isUnhandledChain = ({ node = {} } = {}) => {
    const methods = getChainMethods(node);

    return (
        methods.some(method => ['then', 'finally'].includes(method)) &&
        !methods.includes('catch')
    );
};

const isDroppedKnownPromise = ({ node: { type = '', ...sourceNode } = {}, definitions = {} } = {}) => {
    if (type !== 'CallExpression') return false;

    const { kind = 'unknown' } = inferExpression({ type, ...sourceNode }, { functions: definitions });

    return kind === 'promise';
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Require known promise work to handle or propagate rejection',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-unhandled-promise-chain.md'
        },
        schema: [],
        messages: {
            unhandled: 'Handle or explicitly propagate this promise chain rejection; add catch, await, return, or void for intentional fire-and-forget work.'
        }
    },
    create({ report = () => {} } = {}) {
        let definitions = {};

        return {
            Program(node = {}) {
                ({ definitions = {} } = getLocalAnalysisSession(node));
            },
            ExpressionStatement({ expression = {} } = {}) {
                if (!isUnhandledChain({ node: expression }) && !isDroppedKnownPromise({
                    node: expression,
                    definitions
                })) return;

                report({
                    node: expression,
                    messageId: 'unhandled'
                });
            }
        };
    }
};
