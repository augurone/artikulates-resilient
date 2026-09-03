import {
    LOOP_TYPES,
    hasAllowComment,
    hasAwaitExpression,
    hasLoopControl
} from './support/loop-analysis.js';

const reportLoop = ({ report, node = {} } = {}) => {
    if (typeof report !== 'function') return;

    report({
        node,
        messageId: 'prototypeMethod'
    });
};

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
    create({ report = () => {}, sourceCode = {} } = {}) {
        return LOOP_TYPES.reduce((visitors = {}, loopType = '') => ({
            ...visitors,
            [loopType]: (node = {}) => {
                if (
                    hasAwaitExpression(node) ||
                    hasLoopControl(node) ||
                    hasAllowComment({ sourceCode, node })
                ) return;

                reportLoop({ report, node });
            }
        }), {});
    }
};
