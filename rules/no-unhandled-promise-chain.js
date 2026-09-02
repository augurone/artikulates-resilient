import {
    getDefinitions,
    inferExpression
} from './contracts/infer.js';
import { getKind } from './contracts/model.js';

const getStaticPropertyName = ({
    type = '',
    computed = false,
    property: {
        type: propertyType = '',
        name = ''
    } = {}
} = {}) => {
    if (type !== 'MemberExpression' || computed || propertyType !== 'Identifier') return '';
    return name;
};

const getChainMethods = ({ type = '', callee = {} } = {}) => {
    if (type !== 'CallExpression') return [];

    const method = getStaticPropertyName(callee);
    const { object = {} } = callee;

    return [
        ...(method ? [method] : []),
        ...getChainMethods(object)
    ];
};

const isUnhandledChain = ({ node = {} } = {}) => {
    const methods = getChainMethods(node);

    return (
        methods.some(method => ['then', 'finally'].includes(method)) &&
        !methods.includes('catch')
    );
};

const isDroppedKnownPromise = ({ node = {}, definitions = {} } = {}) => (
    node.type === 'CallExpression' &&
    getKind(inferExpression(node, { functions: definitions })) === 'promise'
);

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
                definitions = getDefinitions(node);
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
