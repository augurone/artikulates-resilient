const LOOP_TYPES = [
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement'
];

const reportLoop = ({ report = () => {}, node = {} } = {}) => {
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
    create({ report = () => {} } = {}) {
        return LOOP_TYPES.reduce((visitors = {}, loopType = '') => ({
            ...visitors,
            [loopType]: (node = {}) => reportLoop({ report, node })
        }), {});
    }
};
